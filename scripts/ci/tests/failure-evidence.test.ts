// Failure evidence (src/support/failure-evidence.ts): the publishable record of a failed scenario.
// Every value is synthetic; assertions report whether a value leaked, never the value.
import assert from 'node:assert/strict';
import { AssertionError } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  FailureTimeline,
  expectedAndReceived,
  TIMELINE_LIMIT,
  failureRecord,
  failureSummary,
  type FailureFacts,
} from '../../../src/support/failure-evidence';
import { scanText } from '../evidence-scan';

const PASSWORD = 'PwSyntheticValue0042';
const USERNAME = 'qa0failure0042';
const SSN = '000-42-4242';
const SESSION = 'ABCDEF0123456789';
const SECRETS = [PASSWORD, USERNAME, SSN];

function facts(overrides: Partial<FailureFacts> = {}): FailureFacts {
  return {
    feature: 'features\\transfers\\transfer-funds.feature',
    scenario: 'I transfer money between my accounts',
    failedStep: 'Then my source account should be debited by $10.00',
    error: new Error('Balance mismatch'),
    startedAt: '2026-10-14T12:00:00.000Z',
    environment: 'qa',
    pageUrl: `http://parabank-qa-parabank-1:8080/parabank/transfer.htm;jsessionid=${SESSION}?id=13344`,
    browser: 'chromium 140.0',
    build: {
      tag: 'jenkins-Automacao-ParaBank-Playwright-PR-26-1',
      url: 'http://localhost:8080/job/x/1/',
    },
    timeline: [],
    screenshot: 'i-transfer-money-1.png',
    ...overrides,
  };
}

describe('failure record: what it tells', () => {
  const record = failureRecord(facts(), SECRETS);

  it('names the feature, scenario and failed step', () => {
    assert.equal(record.feature, 'features/transfers/transfer-funds.feature');
    assert.equal(record.scenario, 'I transfer money between my accounts');
    assert.equal(record.failedStep, 'Then my source account should be debited by $10.00');
  });

  it('records when, where and on what it failed', () => {
    assert.equal(record.startedAt, '2026-10-14T12:00:00.000Z');
    assert.match(record.failedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(record.environment, 'qa');
    assert.equal(record.build.tag, 'jenkins-Automacao-ParaBank-Playwright-PR-26-1');
    assert.equal(record.browser, 'chromium 140.0');
    assert.equal(record.page, '/parabank/transfer.htm');
    assert.equal(record.screenshot, 'i-transfer-money-1.png');
  });

  it('keeps the error type, message and stack frames', () => {
    assert.equal(record.error.type, 'Error');
    assert.equal(record.error.message, 'Balance mismatch');
    assert.ok((record.error.stack?.length ?? 0) > 0);
  });

  it('takes expected and actual from a Node assertion', () => {
    const error = new AssertionError({ expected: 1000, actual: 900, operator: 'strictEqual' });
    const r = failureRecord(facts({ error }), SECRETS);
    assert.deepEqual([r.error.expected, r.error.actual], ['1000', '900']);
  });

  it("takes expected and received from Playwright's expect message", () => {
    const error = new Error(
      'expect(locator).toHaveText(expected) failed\n\nExpected: "Transfer Complete!"\nReceived: "Error!"',
    );
    const r = failureRecord(facts({ error }), SECRETS);
    assert.deepEqual([r.error.expected, r.error.actual], ['"Transfer Complete!"', '"Error!"']);
  });

  it('identifies a failure outside the steps (a hook)', () => {
    const r = failureRecord(
      facts({ failedStep: undefined, error: undefined, message: 'Before hook failed' }),
      SECRETS,
    );
    assert.match(r.failedStep, /hook/);
    assert.equal(r.error.message, 'Before hook failed');
  });

  it('has a readable summary with the reason first', () => {
    const summary = failureSummary(record);
    assert.match(summary, /^FAILED: I transfer money between my accounts\n/);
    assert.match(summary, /\nStep: Then my source account/);
    assert.match(summary, /\nError: Error: Balance mismatch/);
    assert.match(summary, /\nEnvironment: qa, page \/parabank\/transfer\.htm/);
  });
});

describe('failure record: what it never publishes', () => {
  const timeline = new FailureTimeline();
  timeline.step(`When I sign in as ${USERNAME}`, 'PASSED', 120);
  timeline.request(
    'POST',
    `http://h/parabank/login.htm;jsessionid=${SESSION}?username=${USERNAME}&password=${PASSWORD}`,
    302,
  );
  timeline.error(
    'console-error',
    `Customer [username=${USERNAME}, password=${PASSWORD}, ssn=${SSN}]`,
  );
  const error = new AssertionError({
    message: `login failed for ${USERNAME} with ${PASSWORD}; cookie: JSESSIONID=${SESSION}`,
    expected: { ssn: SSN },
    actual: { password: PASSWORD },
    operator: 'deepStrictEqual',
  });
  const json = JSON.stringify(failureRecord(facts({ error, timeline: timeline.events }), SECRETS));

  it('contains none of the generated values or the session id', () => {
    for (const value of [...SECRETS, SESSION]) assert.equal(json.includes(value), false);
  });

  it('keeps request shapes only: method, path without query or session, status', () => {
    assert.ok(json.includes('"method":"POST","path":"/parabank/login.htm","status":302'));
  });

  it('passes the evidence scan that runs before Jenkins publishes', () => {
    assert.deepEqual(scanText(json), []);
  });

  it('keeps every step, and only the last requests and errors', () => {
    const long = new FailureTimeline();
    for (let i = 0; i < 12; i++) long.step(`step ${i}`, 'PASSED', 1);
    for (let i = 0; i < TIMELINE_LIMIT + 25; i++)
      long.request('GET', `http://h/parabank/p${i}.htm`, 200);
    const kinds = long.events.map((event) => event.kind);
    assert.equal(kinds.filter((kind) => kind === 'step').length, 12);
    assert.equal(kinds.filter((kind) => kind === 'request').length, TIMELINE_LIMIT);
  });
});

describe("failure record: Playwright's diff message", () => {
  // The message of a real run (2026-10-14): toHaveText on an element that never appeared.
  const message = [
    'Error: expect(locator).toHaveText(expected) failed',
    '',
    "Locator: locator('#rightPanel .error:visible')",
    'Timeout: 10000ms',
    '- Expected  - 3',
    '+ Received  + 1',
    '',
    '- Array [',
    '-   "The username and password could not be verified.",',
    '- ]',
    '+ Array []',
    '',
    'Call log:',
    "  - waiting for locator('#rightPanel .error:visible')",
  ].join('\n');

  it('takes expected and received from the diff, not from the call log', () => {
    assert.deepEqual(expectedAndReceived(message), {
      expected: 'Array [ "The username and password could not be verified.", ]',
      actual: 'Array []',
    });
  });

  it('ignores the console noise of the images the suite aborts itself, keeps real errors', () => {
    const t = new FailureTimeline();
    t.error('console-error', 'Failed to load resource: net::ERR_FAILED');
    t.error(
      'console-error',
      'Failed to load resource: the server responded with a status of 500 ()',
    );
    t.error('page-error', 'TypeError: x is undefined');
    assert.deepEqual(
      t.events.map((event) => event.kind),
      ['console-error', 'page-error'],
    );
  });

  it("lists the project's own stack frames before library frames", () => {
    const error = new Error('boom');
    error.stack = [
      'Error: boom',
      '    at lib (C:\\p\\node_modules\\playwright-core\\lib\\a.js:1:1)',
      '    at World.step (C:\\p\\src\\step-definitions\\transfer.steps.ts:42:5)',
    ].join('\n');
    const r = failureRecord(facts({ error }), SECRETS);
    assert.match(r.error.stack?.[0] ?? '', /transfer\.steps\.ts:42/);
  });

  it('keeps only stack frames, not the repeated message', () => {
    const error = new Error(message);
    const r = failureRecord(facts({ error }), SECRETS);
    assert.ok(r.error.stack?.every((frame) => frame.startsWith('at ')));
  });
});

describe('failure evidence: wiring', () => {
  const hooks = readFileSync('src/support/hooks.ts', 'utf8');
  const jenkinsfile = readFileSync('Jenkinsfile', 'utf8');

  it('writes the record and the screenshot under the reports directory (scanned, then archived)', () => {
    assert.match(hooks, /path\.join\(config\.reportsDir, 'failures'\)/);
    assert.match(jenkinsfile, /ci:evidence-scan -- --quarantine reports build deployment/);
    assert.match(jenkinsfile, /archiveArtifacts artifacts: 'reports\/\*\*/);
  });

  it('records the failed step from the AfterStep hook, only the first one', () => {
    assert.match(hooks, /AfterStep\(/);
    assert.match(hooks, /Status\.FAILED && !this\.failure/);
  });

  it('produces no trace in CI (traces cannot be redacted): only the opt-in local one', () => {
    assert.match(hooks, /config\.traceOnFailure && ownsBrowser/);
    assert.match(jenkinsfile, /^\s*PW_TRACE_ON_FAILURE = 'false'$/m);
    assert.equal(
      jenkinsfile.match(/PW_TRACE_ON_FAILURE/g)?.length,
      1,
      'never set to anything else',
    );
  });

  it('never turns a failed build into SUCCESS during post-processing', () => {
    assert.doesNotMatch(jenkinsfile, /currentBuild\.result\s*=\s*'SUCCESS'/);
  });
});
