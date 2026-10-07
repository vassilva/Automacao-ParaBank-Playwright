/**
 * Proves that one suite's run kept the suite's promise.
 *
 *   ts-node scripts/ci/verify-suite-coverage.ts --suite <smoke|sanity|regression|full> --expect <N>
 *   ts-node scripts/ci/verify-suite-coverage.ts --suite <...> --expect <N> <reports dir>
 *
 * 1. Inventory: a Cucumber dry run of the suite's profile (cucumber.js) must select exactly N
 *    scenarios, the approved count. A tag edit that silently adds or drops scenarios fails here,
 *    before anything is deployed (the first form checks only this).
 * 2. Execution (with a reports dir): the run's cucumber-report.json must contain exactly the
 *    suite's inventory, each scenario once, and every scenario passed.
 *
 * Every suite is validated on its own: nothing assumes that suites add up to another suite.
 * The dry run writes its reports to a RELATIVE directory, so no Windows drive letter ever ends up
 * in a Cucumber format option ("html:C:\..." is not parseable).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const SUITES = ['smoke', 'sanity', 'regression', 'full'] as const;
type Suite = (typeof SUITES)[number];

interface JsonStep {
  result: { status: string };
}
interface JsonElement {
  type: string;
  line: number;
  name: string;
  steps: JsonStep[];
  before?: JsonStep[];
  after?: JsonStep[];
}
interface JsonFeature {
  uri: string;
  elements?: JsonElement[];
}

function scenarios(reportFile: string) {
  if (!existsSync(reportFile)) throw new Error(`No Cucumber JSON report at ${reportFile}`);
  const features = JSON.parse(readFileSync(reportFile, 'utf8')) as JsonFeature[];
  return features.flatMap((feature) =>
    (feature.elements ?? [])
      .filter((element) => element.type === 'scenario')
      .map((element) => ({
        id: `${feature.uri.replace(/\\/g, '/')}:${element.line}`,
        name: element.name,
        passed: [...(element.before ?? []), ...element.steps, ...(element.after ?? [])].every(
          (step) => step.result.status === 'passed',
        ),
      })),
  );
}

function inventory(suite: Suite): Set<string> {
  mkdirSync('reports', { recursive: true });
  const dir = path.relative(process.cwd(), mkdtempSync(path.join('reports', '.inventory-')));
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join('node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js'),
        '--profile',
        suite,
        '--dry-run',
      ],
      { env: { ...process.env, REPORTS_DIR: dir }, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(`Cucumber dry run of "${suite}" failed:\n${result.stderr || result.stdout}`);
    }
    return new Set(scenarios(path.join(dir, 'cucumber-report.json')).map((s) => s.id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main(): void {
  const suite = option('--suite') as Suite | undefined;
  const expectedCount = Number(option('--expect'));
  const reportsDir = process.argv
    .slice(2)
    .filter((arg, i, all) => !arg.startsWith('--') && !all[i - 1]?.startsWith('--'))[0];
  if (!suite || !SUITES.includes(suite) || !Number.isInteger(expectedCount)) {
    throw new Error(
      `Usage: verify-suite-coverage.ts --suite <${SUITES.join('|')}> --expect <N> [reports dir]`,
    );
  }

  const expected = inventory(suite);
  if (expected.size !== expectedCount) {
    throw new Error(
      `SUITE INVENTORY MISMATCH: "${suite}" selects ${expected.size} scenarios, the approved ` +
        `count is ${expectedCount}. Review the tag change and the approved counts together.`,
    );
  }
  console.log(`Suite "${suite}": ${expected.size} scenarios, as approved.`);
  if (!reportsDir) return;

  const executed = scenarios(path.join(reportsDir, 'cucumber-report.json'));
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const scenario of executed) {
    if (seen.has(scenario.id)) problems.push(`ran twice: ${scenario.id} (${scenario.name})`);
    seen.add(scenario.id);
    if (!scenario.passed) problems.push(`not passed: ${scenario.id} (${scenario.name})`);
    if (!expected.has(scenario.id)) problems.push(`not in the ${suite} suite: ${scenario.id}`);
  }
  for (const id of expected) if (!seen.has(id)) problems.push(`never executed: ${id}`);
  if (problems.length > 0) {
    throw new Error(`COVERAGE CHECK FAILED (${suite}, ${reportsDir}):\n  ${problems.join('\n  ')}`);
  }
  console.log(
    `COVERAGE OK (${suite}): all ${expected.size}/${expected.size} scenarios executed once and passed (${reportsDir}).`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
