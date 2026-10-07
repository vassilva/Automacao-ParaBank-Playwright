/**
 * Shared Playwright Test configuration for the Cucumber (Gherkin) suite.
 *
 * Two configs build on this one:
 *   playwright.config.ts                 default: the 52 normal scenarios (@known-defect excluded)
 *   playwright.known-defects.config.ts   the 25 @known-defect scenarios
 *
 * The only test file is playwright/cucumber.spec.ts, which declares one test per Gherkin scenario
 * and executes it through Cucumber (see playwright/cucumber-runtime.ts). grep / grepInvert choose
 * which of those tests run, exactly as Cucumber's tag filter selects scenarios. Step definitions
 * are Cucumber support code, not Playwright tests, and are deliberately outside testDir.
 *
 * Browser ownership: Playwright Test launches the browser (`use` below) and lends it to the
 * Cucumber hooks; the World still creates one isolated context per scenario. Defaults come from
 * src/support/config.ts (.env), the same values native cucumber-js uses; --headed and UI Mode
 * override them as in any Playwright project.
 */
import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import { config } from './src/support/config';

// Sensitive data: on failure Playwright may write an ARIA snapshot of the page into
// error-context.md. A failing page can show credentials (ParaBank's login recovery prints the
// password), so that snapshot is disabled. error-context.md is still written, holding only the
// (already redacted) error message and a source code frame. Applies to the runner and workers.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export interface SuiteSelection {
  /** Report directory for this run, so normal and known-defect reports never overwrite each other. */
  reportsDir: string;
  grep?: RegExp;
  grepInvert?: RegExp;
}

export function cucumberPlaywrightConfig(selection: SuiteSelection): PlaywrightTestConfig {
  return defineConfig({
    testDir: './playwright',
    testMatch: 'cucumber.spec.ts',
    globalSetup: './playwright/global-setup.ts',
    // ParaBank has a confirmed registration concurrency defect: scenarios run one at a time.
    // global-setup.ts refuses any command-line override of this value.
    workers: 1,
    fullyParallel: false,
    retries: 0,
    forbidOnly: true,
    grep: selection.grep,
    grepInvert: selection.grepInvert,
    // Cucumber enforces its own per-step timeout (src/support/config.ts); this bounds a scenario.
    timeout: 5 * 60_000,
    outputDir: `${selection.reportsDir}/test-results`,
    use: {
      browserName: 'chromium',
      headless: config.headless,
      launchOptions: { slowMo: config.slowMo },
      // Traces hold the synthetic customer's password (network and fill actions): opt-in only, as
      // in native runs (PW_TRACE_ON_FAILURE). UI Mode always records one, locally.
      trace: config.traceOnFailure ? 'retain-on-failure' : 'off',
    },
    reporter: [
      // First: redacts typed values and sensitive text in step titles before any report is written.
      ['./playwright/redacting-reporter.ts'],
      ['list'],
      ['html', { outputFolder: `${selection.reportsDir}/html`, open: 'never' }],
      ['junit', { outputFile: `${selection.reportsDir}/junit.xml` }],
    ],
  });
}

/** Report root, overridable with REPORTS_DIR (as the CI stages do). */
export const reportsRoot = process.env.REPORTS_DIR || 'reports';

/** Scenarios that state the correct behavior of a confirmed product defect (docs/defects.md). */
export const KNOWN_DEFECT = /@known-defect/;
