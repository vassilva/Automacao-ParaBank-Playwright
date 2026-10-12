/**
 * Which part of a ParaBank container log a teardown archives (scripts/environment.ts), as pure
 * functions so the edge cases are tested without Docker (scripts/ci/tests/log-capture.test.ts).
 *
 * QA and UAT are persistent, so the whole container log repeats every earlier build. A successful
 * build therefore archives only its own window (`sinceMs` = the build start). Whenever that window
 * cannot be trusted (invalid or future start, or nothing logged in it) the whole log is archived
 * instead and the reason is reported: evidence is never silently empty. Every path is redacted.
 */
import { redactLog } from './log-redaction';

/** Earlier than any build of this project: anything below is not a real build start. */
const EARLIEST_MS = Date.UTC(2020, 0, 1);
/** Jenkins and the Docker daemon share one clock; allow a little skew before calling it future. */
const FUTURE_TOLERANCE_MS = 60_000;

export interface LogWindow {
  /** RFC 3339 start for `docker compose logs --since`; absent means the whole log. */
  since?: string;
  warning?: string;
}

export function logWindow(sinceMs: string | undefined, nowMs: number): LogWindow {
  if (sinceMs === undefined) return {};
  const ms = /^\d{1,16}$/.test(sinceMs) ? Number(sinceMs) : Number.NaN;
  if (!(ms >= EARLIEST_MS)) {
    return { warning: `--logs-since-ms is not a valid build start (${sinceMs.slice(0, 32)})` };
  }
  if (ms > nowMs + FUTURE_TOLERANCE_MS) {
    return { warning: `--logs-since-ms ${new Date(ms).toISOString()} is in the future (clock?)` };
  }
  return { since: new Date(ms).toISOString() };
}

export interface CollectedLog {
  text: string;
  scope: string;
  warnings: string[];
}

/**
 * `fetch(since)` returns the raw log (`since` undefined = the whole log). The result is always
 * redacted; warnings explain every fallback and never contain log content.
 */
export function collectLog(
  fetch: (since?: string) => string,
  sinceMs: string | undefined,
  nowMs: number,
): CollectedLog {
  const warnings: string[] = [];
  const window = logWindow(sinceMs, nowMs);
  if (window.warning) warnings.push(`${window.warning}: archiving the whole container log`);
  if (window.since) {
    const scoped = fetch(window.since);
    if (scoped.trim()) {
      return { text: redactLog(scoped), scope: `since ${window.since}`, warnings };
    }
    warnings.push(`no log lines since ${window.since}: archiving the whole container log`);
  }
  const whole = fetch();
  if (!whole.trim()) warnings.push('the container log is empty');
  return { text: redactLog(whole), scope: 'whole container log', warnings };
}
