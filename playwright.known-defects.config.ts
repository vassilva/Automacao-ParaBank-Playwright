/**
 * Playwright Test entry point for the 25 @known-defect scenarios.
 *
 *   npm run test:known-defects
 *
 * These scenarios state the correct behavior of a confirmed product defect (docs/defects.md) and
 * are expected to fail until the defect is fixed. The adapter (playwright/cucumber.spec.ts) reports
 * a genuine reproduction as an expected failure; a scenario that now passes is flagged as
 * "no longer reproduces". Kept out of the default `npx playwright test` run.
 */
import { cucumberPlaywrightConfig, reportsRoot, KNOWN_DEFECT } from './playwright.config.base';

export default cucumberPlaywrightConfig({
  reportsDir: `${reportsRoot}/playwright-known-defects`,
  grep: KNOWN_DEFECT,
});
