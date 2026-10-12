// Scope of the archived ParaBank container log (scripts/log-capture.ts), without Docker: the fetch
// is a fake that records which window was asked for. Fixtures are synthetic; assertions report
// booleans and scopes, never log content.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectLog, logWindow } from '../../log-capture';

const NOW = Date.UTC(2026, 9, 12, 20, 0, 0);
const BUILD_START = String(NOW - 5 * 60_000);
const SECRET = 'SyntheticPw-0000-Example';
const LINE = `2026-10-12T19:58:00Z INFO Customer [username=qaexample0001, password=${SECRET}]`;

/** A fake container log: the scoped window and the whole history are different texts. */
function fakeFetch(scoped: string, whole: string) {
  const calls: (string | undefined)[] = [];
  const fetch = (since?: string) => {
    calls.push(since);
    return since ? scoped : whole;
  };
  return { fetch, calls };
}

describe('log window', () => {
  it('uses no window when none is given (whole log)', () => {
    assert.deepEqual(logWindow(undefined, NOW), {});
  });

  it('turns a build start into an RFC 3339 --since value, milliseconds kept', () => {
    assert.deepEqual(logWindow(String(NOW - 1234), NOW), {
      since: new Date(NOW - 1234).toISOString(),
    });
  });

  for (const invalid of ['', 'yesterday', '-5', '1.5e12', '0', '99', '12345678901234567890']) {
    it(`rejects ${JSON.stringify(invalid)} as a build start, with a warning`, () => {
      const window = logWindow(invalid, NOW);
      assert.equal(window.since, undefined);
      assert.match(window.warning ?? '', /not a valid build start/);
    });
  }

  it('rejects a start in the future beyond the clock tolerance', () => {
    const window = logWindow(String(NOW + 10 * 60_000), NOW);
    assert.equal(window.since, undefined);
    assert.match(window.warning ?? '', /in the future/);
  });

  it('accepts a start slightly ahead within the clock tolerance', () => {
    assert.ok(logWindow(String(NOW + 30_000), NOW).since);
  });
});

describe('collected log', () => {
  it('successful build: archives only its own window, redacted, without warnings', () => {
    const { fetch, calls } = fakeFetch(LINE, `OLD HISTORY\n${LINE}`);
    const log = collectLog(fetch, BUILD_START, NOW);
    assert.deepEqual(calls, [new Date(Number(BUILD_START)).toISOString()]);
    assert.match(log.scope, /^since /);
    assert.equal(log.warnings.length, 0);
    assert.ok(!log.text.includes('OLD HISTORY'), 'earlier history must not be repeated');
    assert.ok(!log.text.includes(SECRET), 'the password must be redacted');
    assert.ok(log.text.includes('INFO Customer'), 'diagnostic context must remain');
  });

  it('failed or aborted build (no window): archives the whole log, pre-build faults included', () => {
    const { fetch, calls } = fakeFetch('', `PRE-BUILD FAULT\n${LINE}`);
    const log = collectLog(fetch, undefined, NOW);
    assert.deepEqual(calls, [undefined]);
    assert.equal(log.scope, 'whole container log');
    assert.ok(log.text.includes('PRE-BUILD FAULT'));
    assert.ok(!log.text.includes(SECRET), 'the whole log is redacted too');
  });

  it('invalid start: falls back to the whole log and says why', () => {
    const { fetch, calls } = fakeFetch(LINE, `HISTORY\n${LINE}`);
    const log = collectLog(fetch, 'not-a-time', NOW);
    assert.deepEqual(calls, [undefined]);
    assert.equal(log.scope, 'whole container log');
    assert.ok(log.text.includes('HISTORY'));
    assert.match(log.warnings.join('\n'), /not a valid build start.*whole container log/);
  });

  it('future start: falls back to the whole log and says why', () => {
    const { fetch } = fakeFetch('', `HISTORY\n${LINE}`);
    const log = collectLog(fetch, String(NOW + 3_600_000), NOW);
    assert.equal(log.scope, 'whole container log');
    assert.ok(log.text.includes('HISTORY'));
    assert.match(log.warnings.join('\n'), /in the future/);
  });

  it('empty window: never archives silently empty evidence', () => {
    const { fetch, calls } = fakeFetch('  \n', `HISTORY\n${LINE}`);
    const log = collectLog(fetch, BUILD_START, NOW);
    assert.equal(calls.length, 2, 'the whole log is fetched after an empty window');
    assert.equal(log.scope, 'whole container log');
    assert.ok(log.text.includes('HISTORY'));
    assert.match(log.warnings.join('\n'), /no log lines since/);
  });

  it('reports an empty container log instead of claiming evidence', () => {
    const { fetch } = fakeFetch('', '');
    const log = collectLog(fetch, undefined, NOW);
    assert.match(log.warnings.join('\n'), /container log is empty/);
  });

  it('warnings never contain log content', () => {
    const { fetch } = fakeFetch('', LINE);
    const log = collectLog(fetch, 'bad', NOW);
    assert.ok(log.warnings.every((w) => !w.includes(SECRET) && !w.includes('qaexample')));
  });
});
