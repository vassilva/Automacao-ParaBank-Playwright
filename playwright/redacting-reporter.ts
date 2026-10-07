/**
 * Redaction boundary for Playwright's own reports. Listed first in the config, so it runs before
 * the HTML and JUnit reporters serialize anything.
 *
 * Playwright records every browser and API call of a test as a report step, and an input step's
 * title carries the typed value (`Fill "<value>"`). Those values include the synthetic
 * credentials and SSNs of the scenario's customers, so typed values are always replaced, whatever
 * they look like, and every other step title and subtitle (request URLs, target locators) goes
 * through redact().
 * Steps keep their action, location and duration, so the report stays useful for diagnosis.
 */
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { redact } from '../src/support/redaction';

const INPUT_STEP = /^(Fill|Type|Press sequentially) [\s\S]*$/;

function sanitize(step: TestStep): void {
  step.title = INPUT_STEP.test(step.title)
    ? step.title.replace(INPUT_STEP, '$1 "[REDACTED]"')
    : redact(step.title);
  // The target locator or navigation URL, e.g. a heading matched by the customer's username.
  if (step.subtitle) step.subtitle = redact(step.subtitle);
  step.steps.forEach(sanitize);
}

export default class RedactingReporter implements Reporter {
  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep): void {
    sanitize(step);
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    result.steps.forEach(sanitize);
  }

  printsToStdio(): boolean {
    return false;
  }
}
