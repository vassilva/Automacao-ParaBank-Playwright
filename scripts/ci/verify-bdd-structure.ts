/**
 * BDD structure check: every scenario follows the documented tagging rules (docs/test-suites.md,
 * docs/defects.md). Part of the Quality Gates, so it runs on every push and PR before anything is
 * deployed.
 *
 *   ts-node scripts/ci/verify-bdd-structure.ts --total <N> --known-defects <N>
 *
 * Rules, per scenario (after tag inheritance from Feature/Rule/Examples):
 *   - exactly one functional-area tag (the feature's domain) and exactly one priority (@p0..@p2);
 *   - only known tags: areas, priorities, suites, @known-defect and @PB-<nn>;
 *   - Smoke is a subset of Regression ("Smoke ⊂ Regression ⊂ Full");
 *   - a known-defect scenario has exactly one @PB-<nn>, registered in docs/defects.md and with a
 *     registered proof (playwright/known-defect-proofs.ts), and no suite tag (it never gates);
 *   - a normal scenario has no @PB-<nn> tag;
 *   - the inventory has the approved total and known-defect count.
 * Scenarios come from Cucumber dry runs of the "full" and "known-defects" profiles, written to a
 * relative directory (no drive letter in a format option).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const AREAS = [
  'accounts',
  'authentication',
  'authorization',
  'loan',
  'payments',
  'profile',
  'public',
  'registration',
  'transactions',
  'transfer',
];
const PRIORITIES = ['p0', 'p1', 'p2'];
const SUITES = ['smoke', 'sanity', 'regression'];

interface Scenario {
  id: string;
  name: string;
  tags: string[];
}

function dryRun(profile: string): Scenario[] {
  mkdirSync('reports', { recursive: true });
  const dir = path.relative(process.cwd(), mkdtempSync(path.join('reports', '.bdd-')));
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join('node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js'),
        '--profile',
        profile,
        '--dry-run',
      ],
      { env: { ...process.env, REPORTS_DIR: dir }, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(
        `Cucumber dry run of "${profile}" failed:\n${result.stderr || result.stdout}`,
      );
    }
    const features = JSON.parse(readFileSync(path.join(dir, 'cucumber-report.json'), 'utf8')) as {
      uri: string;
      elements?: { type: string; line: number; name: string; tags?: { name: string }[] }[];
    }[];
    return features.flatMap((feature) =>
      (feature.elements ?? [])
        .filter((element) => element.type === 'scenario')
        .map((element) => ({
          id: `${feature.uri.replace(/\\/g, '/')}:${element.line}`,
          name: element.name,
          tags: (element.tags ?? []).map((tag) => tag.name.replace(/^@/, '')),
        })),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function option(name: string): number {
  const index = process.argv.indexOf(name);
  const value = Number(index === -1 ? undefined : process.argv[index + 1]);
  if (!Number.isInteger(value)) {
    throw new Error('Usage: verify-bdd-structure.ts --total <N> --known-defects <N>');
  }
  return value;
}

function main(): void {
  const expectedTotal = option('--total');
  const expectedKnownDefects = option('--known-defects');
  const registered = new Set(readFileSync('docs/defects.md', 'utf8').match(/PB-\d+/g) ?? []);
  const proofs = readFileSync(path.join('playwright', 'known-defect-proofs.ts'), 'utf8');

  const scenarios = [...dryRun('full'), ...dryRun('known-defects')];
  const problems: string[] = [];
  const ids = new Set<string>();
  let knownDefects = 0;

  for (const s of scenarios) {
    const where = `${s.id} (${s.name})`;
    if (ids.has(s.id)) problems.push(`selected by both "full" and "known-defects": ${where}`);
    ids.add(s.id);
    const tags = new Set(s.tags);
    const areas = AREAS.filter((t) => tags.has(t));
    const priorities = PRIORITIES.filter((t) => tags.has(t));
    const suites = SUITES.filter((t) => tags.has(t));
    const defects = s.tags.filter((t) => /^PB-\d+$/.test(t));
    const known = tags.has('known-defect');
    const unknown = s.tags.filter(
      (t) =>
        !AREAS.includes(t) &&
        !PRIORITIES.includes(t) &&
        !SUITES.includes(t) &&
        t !== 'known-defect' &&
        !/^PB-\d+$/.test(t),
    );

    if (areas.length !== 1)
      problems.push(`needs exactly one area tag, has [${areas.join(', ')}]: ${where}`);
    if (priorities.length !== 1) {
      problems.push(`needs exactly one priority tag, has [${priorities.join(', ')}]: ${where}`);
    }
    if (unknown.length > 0) problems.push(`unknown tag(s) @${unknown.join(', @')}: ${where}`);
    if (tags.has('smoke') && !tags.has('regression')) {
      problems.push(`@smoke without @regression (Smoke must be a subset of Regression): ${where}`);
    }
    if (known) {
      knownDefects += 1;
      if (suites.length > 0)
        problems.push(`known defect with suite tag [${suites.join(', ')}]: ${where}`);
      if (defects.length !== 1) {
        problems.push(
          `known defect needs exactly one @PB-<nn>, has [${defects.join(', ')}]: ${where}`,
        );
      }
      for (const id of defects) {
        if (!registered.has(id)) problems.push(`${id} is not in docs/defects.md: ${where}`);
        if (!proofs.includes(`'${id}'`)) {
          problems.push(`${id} has no registered proof (known-defect-proofs.ts): ${where}`);
        }
      }
    } else if (defects.length > 0) {
      problems.push(`@${defects.join(', @')} on a scenario that is not @known-defect: ${where}`);
    }
  }

  if (scenarios.length !== expectedTotal) {
    problems.push(
      `inventory has ${scenarios.length} scenarios, the approved total is ${expectedTotal}`,
    );
  }
  if (knownDefects !== expectedKnownDefects) {
    problems.push(
      `inventory has ${knownDefects} known-defect scenarios, the approved count is ${expectedKnownDefects}`,
    );
  }
  if (problems.length > 0) {
    throw new Error(`BDD STRUCTURE CHECK FAILED:\n  ${problems.join('\n  ')}`);
  }
  console.log(
    `BDD STRUCTURE OK: ${scenarios.length} scenarios (${knownDefects} known defects), one area and ` +
      'one priority each, known tags only, Smoke ⊂ Regression, every known defect registered with ' +
      'a proof and outside every suite.',
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
