// Sensitive-data redaction (objectives 16 and 22): Docker/application logs (scripts/log-redaction.ts),
// failure messages and report text (src/support/redaction.ts) and Playwright report steps
// (playwright/redacting-reporter.ts). Every value is synthetic. Assertions never print a fixture:
// they report only whether a value leaked or a diagnostic survived.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import RedactingReporter from '../../../playwright/redacting-reporter';
import { protectValues, redact, redactError } from '../../../src/support/redaction';
import { lineRedactor, redactLog, redactLogLine } from '../../log-redaction';

const SECRET = 'SyntheticSecretValue42';
const GENERATED_PASSWORD = 'PwAbCdEfGhIjKlMnOp'; // the factory's shape: "Pw" + 16 base64url
const GENERATED_USERNAME = 'qa0example0001'; // the factory's shape: "qa" + lowercase/digits
const SYNTHETIC_SSN = '000-12-3456';

/** Every way a credential, session or token reaches a log or a message in this project. */
const SENSITIVE: [string, string][] = [
  ['ParaBank toString', `Customer [username=${SECRET}, password=${SECRET}, ssn=${SECRET}]`],
  ['double-quoted value', `password="${SECRET}"`],
  ['single-quoted value', `username='${SECRET}'`],
  ['spaced value', `password = ${SECRET}`],
  ['JSON response body', `{"id":13344,"username":"${SECRET}","ssn":"${SECRET}"}`],
  ['spaced JSON', `{ "password" : "${SECRET}" }`],
  ['form body', `customer.password=${SECRET}&customer.ssn=${SECRET}&amount=10`],
  ['query string', `GET /parabank/login.htm?username=${SECRET}&password=${SECRET}`],
  ['session id in URL', `/parabank/overview.htm;jsessionid=${SECRET}`],
  ['cookie header', `Cookie: JSESSIONID=${SECRET}`],
  ['set-cookie header', `set-cookie: JSESSIONID=${SECRET}; Path=/parabank`],
  ['authorization header', `Authorization: Bearer ${SECRET}`],
  ['bare bearer token', `retrying with Bearer ${SECRET} now`],
  ['token parameter', `GET /api?access_token=${SECRET}&page=2`],
  ['api key header', `x-api-key: ${SECRET}`],
  ['client secret', `client_secret="${SECRET}"`],
];

const DIAGNOSTIC =
  '2026-10-12T19:58:00Z ERROR TransferController: HTTP 500 on /parabank/services_proxy/bank/transfer ' +
  'fromAccountId=13344 toAccountId=13455 amount=128.45 (Transfer Complete! not shown)';
/** Parts of DIAGNOSTIC that must survive redaction (ids, amounts, paths, status, messages). */
const KEPT = [
  'ERROR TransferController',
  'HTTP 500',
  '/parabank/services_proxy/bank/transfer',
  '13344',
  '128.45',
  'Transfer Complete!',
];

describe('Docker and application logs (scripts/log-redaction.ts)', () => {
  for (const [name, line] of SENSITIVE) {
    it(`masks a ${name}`, () => {
      assert.ok(!redactLogLine(line).includes(SECRET), `${name}: value leaked`);
    });
  }

  it('masks SSN-shaped values of any area and the generated credential shapes', () => {
    const out = redactLog(
      `ssn ${SYNTHETIC_SSN} vendor 123-45-6789 ${GENERATED_PASSWORD} ${GENERATED_USERNAME}`,
    );
    for (const value of [SYNTHETIC_SSN, '123-45-6789', GENERATED_PASSWORD, GENERATED_USERNAME]) {
      assert.ok(!out.includes(value), 'a generated or SSN-shaped value leaked');
    }
  });

  it('withholds a line whose credential value starts with an unexpected character', () => {
    const out = redactLogLine(`login attempt password=<${SECRET}>`);
    assert.ok(!out.includes(SECRET), 'value leaked');
    assert.match(out, /line withheld/);
  });

  it('keeps ordinary diagnostic information', () => {
    const out = redactLog(DIAGNOSTIC);
    for (const part of KEPT) assert.ok(out.includes(part), `diagnostic lost: ${part}`);
  });

  it('redacts a value split across streamed chunks', () => {
    let written = '';
    const stream = lineRedactor((text) => (written += text));
    stream.push(`user log: password=${SECRET.slice(0, 7)}`);
    stream.push(`${SECRET.slice(7)}, ok\nnext line`);
    stream.flush();
    assert.ok(
      !written.includes(SECRET) && !written.includes(SECRET.slice(7)),
      'split value leaked',
    );
    assert.ok(written.includes('next line'));
  });

  it('keeps line structure (a log is never dropped)', () => {
    const lines = [DIAGNOSTIC, `password=${SECRET}`, 'plain line'].join('\n');
    assert.equal(redactLog(lines).split('\n').length, 3);
  });
});

describe('failure messages and report text (src/support/redaction.ts)', () => {
  for (const [name, line] of SENSITIVE) {
    it(`masks a ${name}`, () => {
      assert.ok(!redact(line).includes(SECRET), `${name}: value leaked`);
    });
  }

  it('masks registered scenario values wherever they appear, and the generated shapes', () => {
    const registered = 'RegisteredSyntheticValue9';
    protectValues(registered);
    const out = redact(
      `expected text "${registered}" near ${GENERATED_PASSWORD} ${GENERATED_USERNAME} ${SYNTHETIC_SSN}`,
    );
    for (const value of [registered, GENERATED_PASSWORD, GENERATED_USERNAME, SYNTHETIC_SSN]) {
      assert.ok(!out.includes(value), 'a registered or generated value leaked');
    }
  });

  it('masks per-call secrets (the scenario World values)', () => {
    assert.ok(
      !redact(`Welcome AnotherSyntheticName7`, ['AnotherSyntheticName7']).includes(
        'AnotherSyntheticName7',
      ),
    );
  });

  it('sanitizes an error message and stack, keeping its type', () => {
    const error = new TypeError(`request failed: cookie: JSESSIONID=${SECRET}`);
    error.stack = `TypeError: ${error.message}\n    at step (transfer.steps.ts:12:3)`;
    const out = redactError(error) as Error;
    assert.ok(out instanceof TypeError, 'error type changed');
    assert.ok(!out.message.includes(SECRET) && !(out.stack ?? '').includes(SECRET), 'value leaked');
    assert.ok((out.stack ?? '').includes('transfer.steps.ts:12:3'), 'stack location lost');
  });

  it('keeps ordinary diagnostic information', () => {
    const out = redact(DIAGNOSTIC);
    for (const part of KEPT) assert.ok(out.includes(part), `diagnostic lost: ${part}`);
  });

  it('does not mask Gherkin wording or locators that only mention a credential field', () => {
    for (const text of [
      'When I sign in with my username but no password',
      `locator('input[name="username"]')`,
      `getByText('Username:')`,
    ]) {
      assert.equal(redact(text), text);
    }
  });
});

describe('Playwright report steps (playwright/redacting-reporter.ts)', () => {
  const step = (title: string, subtitle?: string, steps: TestStep[] = []) =>
    ({ title, subtitle, steps }) as unknown as TestStep;

  it('replaces every typed value and redacts titles and subtitles, recursively', () => {
    const fill = step(`Fill "${SECRET}"`, `locator('#password')`);
    const type = step(`Type "${SECRET}"`);
    const nav = step('Navigate', `/parabank/overview.htm;jsessionid=${SECRET}`);
    const root = step('Then the transfer should be confirmed', undefined, [fill, type, nav]);
    new RedactingReporter().onStepEnd({} as TestCase, {} as TestResult, root);
    const all = [root, fill, type, nav].map((s) => `${s.title} ${s.subtitle ?? ''}`).join('\n');
    assert.ok(!all.includes(SECRET), 'a typed value or session id leaked into the report');
    assert.equal(fill.title, 'Fill "[REDACTED]"');
    assert.equal(root.title, 'Then the transfer should be confirmed');
    assert.ok(nav.subtitle?.startsWith('/parabank/overview.htm'), 'navigation path lost');
  });
});
