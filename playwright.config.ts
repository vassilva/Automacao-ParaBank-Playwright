/**
 * Default Playwright Test entry point: the 52 normal scenarios.
 *
 *   npx playwright test                       the 52 normal scenarios (@known-defect excluded)
 *   npx playwright test --grep @smoke         smoke (4)
 *   npx playwright test --grep @regression    regression (24)
 *   npx playwright test --grep @sanity        sanity (10)
 *
 * The 25 @known-defect scenarios are not part of this default run; they have their own config
 * (playwright.known-defects.config.ts, via `npm run test:known-defects`), so the normal developer
 * feedback loop is not slowed by scenarios that are expected to fail.
 */
import { cucumberPlaywrightConfig, reportsRoot, KNOWN_DEFECT } from './playwright.config.base';

export default cucumberPlaywrightConfig({
  reportsDir: `${reportsRoot}/playwright`,
  grepInvert: KNOWN_DEFECT,
});
