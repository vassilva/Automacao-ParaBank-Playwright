import { redactPath } from './network-diagnostics';
import { redact } from './redaction';

/**
 * Failure evidence that is safe to publish: a record per failed scenario (what failed, where,
 * when, on which environment, build and browser, and the redacted error) plus a short timeline of
 * what led to it. It is the CI replacement for a Playwright trace: traces hold request bodies,
 * cookies, form values and DOM snapshots (ParaBank even embeds the password in a page, PB-18), so
 * they cannot be redacted and are never produced in CI (docs/ci-cd.md, "Reporting and evidence").
 *
 * The timeline keeps only shapes: step text and status, request method + path (no query, numbers
 * as {n}) + status, and redacted console/page errors. No headers, cookies, bodies or form values.
 */

/** Requests and errors kept per scenario (the last ones); every step is kept. */
export const TIMELINE_LIMIT = 40;
const MAX_TEXT = 600;
const MAX_STACK_LINES = 12;
const SELF_ABORTED = /^Failed to load resource: net::ERR_FAILED$/;

export type TimelineEvent =
  | { at: string; kind: 'step'; text: string; status: string; durationMs: number }
  | { at: string; kind: 'request'; method: string; path: string; status: number }
  | { at: string; kind: 'console-error' | 'page-error'; text: string };

/** Already-shaped record of a scenario's steps (all) and requests and errors (the last ones). */
export class FailureTimeline {
  private readonly steps: TimelineEvent[] = [];
  private readonly recent: TimelineEvent[] = [];

  /** Steps and the last requests/errors, in time order. */
  get events(): TimelineEvent[] {
    return [...this.steps, ...this.recent].sort((a, b) => a.at.localeCompare(b.at));
  }

  private push(event: TimelineEvent): void {
    this.recent.push(event);
    if (this.recent.length > TIMELINE_LIMIT) this.recent.shift();
  }

  step(text: string, status: string, durationMs: number): void {
    this.steps.push({ at: new Date().toISOString(), kind: 'step', text, status, durationMs });
  }

  request(method: string, url: string, status: number): void {
    this.push({
      at: new Date().toISOString(),
      kind: 'request',
      method,
      path: redactPath(url),
      status,
    });
  }

  error(kind: 'console-error' | 'page-error', text: string): void {
    // The suite aborts images and fonts itself (World.openBrowserContext): not a symptom.
    if (kind === 'console-error' && SELF_ABORTED.test(text)) return;
    this.push({ at: new Date().toISOString(), kind, text: text.slice(0, MAX_TEXT) });
  }
}

export interface FailureFacts {
  feature: string;
  scenario: string;
  failedStep?: string;
  error?: unknown;
  /** Cucumber's message for the scenario result, when no step error object is available. */
  message?: string;
  startedAt: string;
  environment: string;
  pageUrl?: string;
  browser?: string;
  build: { tag: string; url?: string };
  timeline: readonly TimelineEvent[];
  screenshot?: string;
}

export interface FailureRecord {
  feature: string;
  scenario: string;
  failedStep: string;
  error: { type: string; message: string; expected?: string; actual?: string; stack?: string[] };
  startedAt: string;
  failedAt: string;
  environment: string;
  page?: string;
  browser?: string;
  build: { tag: string; url?: string };
  screenshot?: string;
  timeline: TimelineEvent[];
}

/** An assertion's expected/actual value as text (JSON for objects, numbers and booleans). */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  const json = JSON.stringify(value) as string | undefined;
  return json ?? `(${typeof value})`;
}

/**
 * Expected and received values in an assertion message: the one-line form ("Expected: x",
 * "Received: y") or Playwright's diff form ("- Expected  - n" / "+ Received  + n", then "- "/"+ "
 * lines up to the call log).
 */
export function expectedAndReceived(message: string): { expected?: string; actual?: string } {
  const line = (label: RegExp) => label.exec(message)?.[1]?.trim();
  const expected = line(/^\s*Expected(?: \w+)?:\s*(.+)$/im);
  const actual = line(/^\s*(?:Received|Actual)(?: \w+)?:\s*(.+)$/im);
  if (expected !== undefined || actual !== undefined) return { expected, actual };
  const lines = message.split('\n');
  const header = lines.findIndex((l) => /^\s*- Expected\b/.test(l));
  if (header === -1) return {};
  const diff: string[] = [];
  for (const l of lines.slice(header + 1)) {
    if (/^\s*Call log:/.test(l)) break;
    if (/^\s*[-+] /.test(l) && !/^\s*\+ Received\b/.test(l)) diff.push(l.trim());
  }
  const side = (sign: string) =>
    diff
      .filter((l) => l.startsWith(sign))
      .map((l) => l.slice(2).trim())
      .join(' ');
  return { expected: side('-'), actual: side('+') };
}

/**
 * The publishable record of one failed scenario. Every free text goes through redact() with the
 * scenario's own generated values; URLs keep their path only.
 */
export function failureRecord(facts: FailureFacts, secrets: readonly string[]): FailureRecord {
  const clean = (value: string) => redact(value, secrets).slice(0, MAX_TEXT);
  const error = facts.error;
  const fields = (error ?? {}) as {
    name?: string;
    message?: string;
    stack?: string;
    expected?: unknown;
    actual?: unknown;
  };
  // Parsed from the whole redacted message; only the published message is shortened.
  const full = redact(
    fields.message ?? facts.message ?? 'The scenario failed without an error message',
    secrets,
  );
  const message = full.slice(0, MAX_TEXT);
  const parsed = expectedAndReceived(full);
  const expected = 'expected' in fields ? clean(text(fields.expected)) : parsed.expected;
  const actual = 'actual' in fields ? clean(text(fields.actual)) : parsed.actual;
  // The project's own frames (steps, page objects) first, then library frames.
  const all = fields.stack
    ? redact(fields.stack, secrets)
        .split('\n')
        .filter((line) => /^\s+at /.test(line))
        .map((line) => line.trim())
    : [];
  const ours = (frame: string) => !frame.includes('node_modules');
  const frames = [...all.filter(ours), ...all.filter((frame) => !ours(frame))].slice(
    0,
    MAX_STACK_LINES,
  );
  const stack = frames.length > 0 ? frames : undefined;
  return {
    feature: facts.feature.split('\\').join('/'),
    scenario: facts.scenario,
    failedStep: facts.failedStep ?? '(a hook, before or after the steps)',
    error: {
      type: fields.name ?? (error instanceof Error ? error.constructor.name : 'Error'),
      message,
      ...(expected !== undefined ? { expected } : {}),
      ...(actual !== undefined ? { actual } : {}),
      ...(stack ? { stack } : {}),
    },
    startedAt: facts.startedAt,
    failedAt: new Date().toISOString(),
    environment: facts.environment,
    ...(facts.pageUrl ? { page: pagePath(facts.pageUrl) } : {}),
    ...(facts.browser ? { browser: facts.browser } : {}),
    build: facts.build,
    ...(facts.screenshot ? { screenshot: facts.screenshot } : {}),
    timeline: facts.timeline.map((event) =>
      event.kind === 'request' ? event : { ...event, text: clean(event.text) },
    ),
  };
}

function pagePath(url: string): string {
  try {
    return redactPath(url);
  } catch {
    return '(no page)';
  }
}

/** Readable summary for the Cucumber report (the JSON file holds the whole record). */
export function failureSummary(record: FailureRecord): string {
  return [
    `FAILED: ${record.scenario}`,
    `Feature: ${record.feature}`,
    `Step: ${record.failedStep}`,
    `Error: ${record.error.type}: ${record.error.message.split('\n')[0]}`,
    ...(record.error.expected !== undefined ? [`Expected: ${record.error.expected}`] : []),
    ...(record.error.actual !== undefined ? [`Actual: ${record.error.actual}`] : []),
    `Environment: ${record.environment}${record.page ? `, page ${record.page}` : ''}`,
    `Build: ${record.build.tag}${record.browser ? `, browser ${record.browser}` : ''}`,
    `At: ${record.failedAt} (started ${record.startedAt})`,
    ...(record.screenshot ? [`Screenshot: ${record.screenshot}`] : []),
  ].join('\n');
}
