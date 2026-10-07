// Cucumber configuration: one execution architecture (Cucumber + Playwright library).
// Profiles: `default` runs every scenario, `smoke` and `regression` filter by tag.
const { existsSync } = require('node:fs');

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const toInteger = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

// One directory per run, so CI stages (smoke, regression, Environment 1/2) never overwrite
// each other's reports.
const reportsDir = process.env.REPORTS_DIR || 'reports';

const common = {
  // Feature paths use Cucumber's default (features/**/*.feature) so that CLI paths such as
  // `features/x.feature:12` select exactly those scenarios instead of being added to a list.
  requireModule: ['ts-node/register'],
  require: ['src/support/**/*.ts', 'src/step-definitions/**/*.ts'],
  format: [
    'summary',
    `html:${reportsDir}/cucumber-report.html`,
    `json:${reportsDir}/cucumber-report.json`,
    `junit:${reportsDir}/cucumber-junit.xml`,
  ],
  formatOptions: { snippetInterface: 'async-await' },
  // One worker on every environment: ParaBank's registration is not safe under concurrent
  // requests (PB-20, docs/defects.md), and every scenario registers its own customer. Jenkins and
  // the Playwright entry point enforce 1; keep CUCUMBER_PARALLEL at 1.
  parallel: toInteger(process.env.CUCUMBER_PARALLEL, 1),
  retry: toInteger(process.env.CUCUMBER_RETRY, 0),
  strict: true,
};

// Suites (risk-based selection, see docs/test-suites.md).
// @known-defect scenarios assert the CORRECT behavior of a confirmed product defect
// (docs/defects.md), so they fail until the defect is fixed. They are kept out of every gating
// suite and run on their own with --profile known-defects (expected to fail). With Playwright they
// run on their own too (npm run test:known-defects), reported as expected failures.
const gating = 'not @known-defect';

module.exports = {
  default: { ...common, tags: gating },
  full: { ...common, tags: gating },
  smoke: { ...common, tags: `@smoke and ${gating}` },
  sanity: { ...common, tags: `@sanity and ${gating}` },
  regression: { ...common, tags: `@regression and ${gating}` },
  'known-defects': { ...common, tags: '@known-defect' },
};
