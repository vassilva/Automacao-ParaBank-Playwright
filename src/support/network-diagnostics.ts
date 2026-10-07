import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config';

/**
 * Opt-in (NET_DIAG=true) traffic accounting used to investigate the edge rate limit.
 * Records only: method, a redacted path (no query string, no ;jsessionid, numbers replaced by
 * {n}), status and a few non-sensitive response headers. Never bodies, cookies or credentials.
 */

export type TrafficKind = 'registration' | 'bank-api' | 'document' | 'static' | 'other';
export type TrafficSource = 'browser' | 'api-client';

export interface TrafficEvent {
  atMs: number;
  source: TrafficSource;
  kind: TrafficKind;
  method: string;
  path: string;
  status: number;
  retryAfter?: string;
  cfMitigated?: string;
}

const SAFE_HEADERS = ['retry-after', 'cf-mitigated', 'server', 'cf-cache-status'] as const;

export function redactPath(url: string): string {
  const { pathname } = new URL(url);
  return pathname.replace(/;jsessionid=[^/]*/i, '').replace(/\d+/g, '{n}');
}

export function classify(method: string, redacted: string, isDocument: boolean): TrafficKind {
  if (redacted.endsWith('/register.htm') && method === 'POST') return 'registration';
  if (redacted.includes('/services_proxy/bank/')) return 'bank-api';
  if (isDocument || redacted.endsWith('.htm')) return 'document';
  if (/\.(css|js)$/.test(redacted)) return 'static';
  return 'other';
}

/** Per worker process: one run timeline across all scenarios of that worker. */
const run = {
  startedAt: Date.now(),
  sent: 0,
  scenarioOrder: 0,
  timeline: [] as number[],
  first429: undefined as
    | (TrafficEvent & {
        scenarioOrder: number;
        scenario: string;
        cumulativeBefore: number;
        sentInPrevious10s: number;
        sentInPrevious60s: number;
      })
    | undefined,
};

export class ScenarioTraffic {
  readonly order: number;
  readonly events: TrafficEvent[] = [];
  blockedLocally = 0;
  private readonly startedAt = Date.now();

  constructor(readonly scenario: string) {
    run.scenarioOrder += 1;
    this.order = run.scenarioOrder;
  }

  record(
    source: TrafficSource,
    method: string,
    url: string,
    status: number,
    headers: Record<string, string>,
    isDocument = false,
  ): void {
    const redacted = redactPath(url);
    const now = Date.now();
    const event: TrafficEvent = {
      atMs: now - run.startedAt,
      source,
      kind: classify(method, redacted, isDocument),
      method,
      path: redacted,
      status,
      ...(headers['retry-after'] ? { retryAfter: headers['retry-after'] } : {}),
      ...(headers['cf-mitigated'] ? { cfMitigated: headers['cf-mitigated'] } : {}),
    };
    if (status === 429 && !run.first429) {
      run.first429 = {
        ...event,
        scenarioOrder: this.order,
        scenario: this.scenario,
        cumulativeBefore: run.sent,
        sentInPrevious10s: run.timeline.filter((t) => now - t <= 10_000).length,
        sentInPrevious60s: run.timeline.filter((t) => now - t <= 60_000).length,
      };
    }
    run.sent += 1;
    run.timeline.push(now);
    this.events.push(event);
  }

  write(status: string): void {
    const count = <K extends string>(keys: K[]) =>
      keys.reduce<Record<string, number>>(
        (acc, key) => ({ ...acc, [key]: (acc[key] ?? 0) + 1 }),
        {},
      );
    const first429 = this.events.find((e) => e.status === 429);
    const summary = {
      order: this.order,
      scenario: this.scenario,
      result: status,
      durationMs: Date.now() - this.startedAt,
      requestsSent: this.events.length,
      imagesNotDownloaded: this.blockedLocally,
      byKind: count(this.events.map((e) => e.kind)),
      bySource: count(this.events.map((e) => e.source)),
      byStatus: count(this.events.map((e) => String(e.status))),
      bankApi: count(
        this.events.filter((e) => e.kind === 'bank-api').map((e) => `${e.method} ${e.path}`),
      ),
      documents: count(
        this.events.filter((e) => e.kind === 'document').map((e) => `${e.method} ${e.path}`),
      ),
      first429InScenario: first429,
      statusesAfterFirst429: first429
        ? count(
            this.events.filter((e) => e.atMs >= first429.atMs).map((e) => `${e.kind}:${e.status}`),
          )
        : undefined,
      cumulativeSentInRun: run.sent,
      runElapsedMs: Date.now() - run.startedAt,
      runFirst429: run.first429,
      safeHeadersRecorded: SAFE_HEADERS,
    };
    const file = path.join(config.reportsDir, 'network-diagnostics.jsonl');
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(summary)}\n`);
  }
}
