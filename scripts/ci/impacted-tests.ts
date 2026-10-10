/**
 * Impacted tests: the normal scenarios a change must run on QA, from the files it changes compared
 * with its target branch (pull requests, and pushes to qa/* branches).
 *
 *   ts-node scripts/ci/impacted-tests.ts select [--base <ref>]   print the selection
 *   ts-node scripts/ci/impacted-tests.ts run    [--base <ref>]   run it and validate it
 *
 * The base defaults to origin/$CHANGE_TARGET (Jenkins PR builds) or origin/main, and is fetched
 * when missing (a Jenkins PR checkout fetches only the PR ref; the repository is public). Files are
 * compared with the merge base (`git diff base...HEAD`), so later commits on main do not count;
 * renames list both paths.
 *
 * Mapping (first matching rule wins, see RULES):
 *   - a feature file                         -> that feature
 *   - a domain's steps or page object        -> that domain's features
 *   - shared code (support layer, API client, factories, shared steps and pages, the Playwright
 *     adapter, runner configuration, dependencies), the application build and environments
 *     (docker/parabank, compose.yaml), and CI/CD tooling (Jenkinsfile, scripts, CI agent image)
 *                                            -> the Regression suite (24)
 *   - documentation, the secondary GitHub Actions workflow, lint/format/ignore rules
 *                                            -> nothing beyond the PR's Smoke
 *   - anything the map does not know         -> the Regression suite (fail-safe)
 * Known-defect scenarios are never selected (the "full" profile excludes them). Changes to the
 * files that define the gates are also reported as GATE-DEFINING (.github/gate-defining-paths.json).
 *
 * `run` executes the selection on the target configured by TARGET_ENV / PARABANK_BASE_URL with
 * reports in reports/<env>/impacted, then checks that exactly the selected scenarios ran, once,
 * and passed (scripts/ci/verify-suite-coverage.ts).
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

type Impact = { kind: 'none' } | { kind: 'regression' } | { kind: 'features'; dirs: string[] };

const NONE: Impact = { kind: 'none' };
const REGRESSION: Impact = { kind: 'regression' };
const features = (...dirs: string[]): Impact => ({ kind: 'features', dirs });

const RULES: [RegExp, Impact | 'self', string][] = [
  [/^features\/.+\.feature$/, 'self', 'feature file'],
  // Domain steps.
  [/^src\/step-definitions\/accounts\.steps\.ts$/, features('accounts'), 'accounts steps'],
  [
    /^src\/step-definitions\/authentication\.steps\.ts$/,
    features('authentication'),
    'authentication steps',
  ],
  [
    /^src\/step-definitions\/authorization\.steps\.ts$/,
    features('authorization'),
    'authorization steps',
  ],
  [/^src\/step-definitions\/bill-pay\.steps\.ts$/, features('payments'), 'bill pay steps'],
  [/^src\/step-definitions\/loan\.steps\.ts$/, features('loans'), 'loan steps'],
  [/^src\/step-definitions\/profile\.steps\.ts$/, features('profile'), 'profile steps'],
  [/^src\/step-definitions\/public\.steps\.ts$/, features('public'), 'public steps'],
  [
    /^src\/step-definitions\/registration\.steps\.ts$/,
    features('registration'),
    'registration steps',
  ],
  [
    /^src\/step-definitions\/transactions\.steps\.ts$/,
    features('transactions'),
    'transaction steps',
  ],
  [/^src\/step-definitions\/transfer\.steps\.ts$/, features('transfers'), 'transfer steps'],
  // Domain page objects.
  [
    /^src\/pages\/(account-activity|open-account)\.page\.ts$/,
    features('accounts'),
    'accounts page',
  ],
  [
    /^src\/pages\/accounts-overview\.page\.ts$/,
    features('accounts', 'authentication'),
    'overview page',
  ],
  [/^src\/pages\/bill-pay\.page\.ts$/, features('payments'), 'bill pay page'],
  [/^src\/pages\/customer-care\.page\.ts$/, features('public'), 'customer care page'],
  [
    /^src\/pages\/customer-lookup\.page\.ts$/,
    features('authentication', 'public'),
    'login recovery page',
  ],
  [/^src\/pages\/find-transactions\.page\.ts$/, features('transactions'), 'find transactions page'],
  [/^src\/pages\/registration\.page\.ts$/, features('registration', 'public'), 'registration page'],
  [/^src\/pages\/request-loan\.page\.ts$/, features('loans'), 'loan page'],
  [/^src\/pages\/transfer-funds\.page\.ts$/, features('transfers'), 'transfer page'],
  [/^src\/pages\/update-profile\.page\.ts$/, features('profile'), 'profile page'],
  // Shared code and the application itself: the whole Regression suite.
  [/^src\/(support|api|factories|utils)\//, REGRESSION, 'shared test code'],
  [/^src\/step-definitions\/(customer|feedback|ledger)\.steps\.ts$/, REGRESSION, 'shared steps'],
  [
    /^src\/pages\/(home\.page|account-services\.menu|feedback\.component|index)\.ts$/,
    REGRESSION,
    'shared page objects',
  ],
  [/^playwright\/|^playwright(\.[a-z-]+)?\.config(\.base)?\.ts$/, REGRESSION, 'Playwright adapter'],
  [
    /^(cucumber\.js|package\.json|package-lock\.json|tsconfig\.json)$/,
    REGRESSION,
    'runner configuration',
  ],
  [/^(docker\/parabank\/|compose\.yaml$)/, REGRESSION, 'application build or runtime'],
  // High-risk tooling: the pipeline and its gates, deployment and readiness, the image build, the
  // agent image (browser runtime), line-ending rules. Regression is cheap compared with a
  // tooling change that silently weakens what QA proves.
  [/^(Jenkinsfile|scripts\/|docker\/ci-agent\/|\.gitattributes$)/, REGRESSION, 'CI/CD tooling'],
  // No functional impact beyond the PR's Smoke.
  [/^docs\/|\.md$/, NONE, 'documentation'],
  [/^\.github\//, NONE, 'GitHub workflows and guard configuration'],
  [
    /^(\.gitignore|\.prettierignore|\.prettierrc\.json|eslint\.config\.mjs|\.env\.example)$/,
    NONE,
    'lint, format and ignore rules (checked by the Quality Gates)',
  ],
];

/**
 * Files that define the gates and security controls (.github/gate-defining-paths.json, the single
 * list). A PR changing them is validated by the gates it changes (Jenkins runs the PR's own
 * Jenkinsfile), so it is reviewed and merged manually. Here they are only reported; the
 * enforcement is .github/workflows/gate-guard.yml, which reads main's copy of the list and turns
 * auto-merge off on such PRs.
 */
const GATE_DEFINING: RegExp[] = (
  JSON.parse(readFileSync(path.join('.github', 'gate-defining-paths.json'), 'utf8')) as {
    patterns: string[];
  }
).patterns.map((pattern) => new RegExp(pattern));

function git(args: string[]): string {
  const result = spawnSync('git', ['-c', 'safe.directory=*', ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function baseRef(): string {
  const index = process.argv.indexOf('--base');
  const base =
    index !== -1 ? process.argv[index + 1] : `origin/${process.env.CHANGE_TARGET || 'main'}`;
  if (!base) throw new Error('--base needs a ref');
  const verify = spawnSync('git', [
    '-c',
    'safe.directory=*',
    'rev-parse',
    '--verify',
    '--quiet',
    `${base}^{commit}`,
  ]);
  if (verify.status !== 0 && base.startsWith('origin/')) {
    const branch = base.slice('origin/'.length);
    const url = git(['config', '--get', 'remote.origin.url']);
    console.log(`Fetching ${branch} for the comparison`);
    git(['fetch', '--no-tags', url, `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  }
  return base;
}

function featureFilesIn(dir: string): string[] {
  const full = path.join('features', dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => name.endsWith('.feature'))
    .map((name) => `features/${dir}/${name}`);
}

export interface Selection {
  base: string;
  changed: { file: string; impact: string; reason: string }[];
  kind: 'none' | 'regression' | 'features';
  features: string[];
  gateDefining: string[];
}

export function select(): Selection {
  const base = baseRef();
  // --no-renames: a rename lists both paths, so moving shared code still selects its impact.
  const changed = git(['diff', '--name-only', '--no-renames', `${base}...HEAD`])
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
  return classify(base, changed);
}

/** The selection for a list of changed files (exported to check the map without git). */
export function classify(base: string, changed: string[]): Selection {
  const selection: Selection = { base, changed: [], kind: 'none', features: [], gateDefining: [] };
  const files = new Set<string>();
  for (const file of changed) {
    if (GATE_DEFINING.some((pattern) => pattern.test(file))) selection.gateDefining.push(file);
    const rule = RULES.find(([pattern]) => pattern.test(file));
    const impact = rule ? rule[1] : REGRESSION;
    const reason = rule ? rule[2] : 'not in the impact map (fail-safe)';
    if (impact === 'self') {
      // A deleted feature file selects nothing; its removal is reviewed in the PR.
      if (existsSync(file)) files.add(file);
      selection.changed.push({ file, impact: 'feature', reason });
    } else if (impact.kind === 'regression') {
      selection.kind = 'regression';
      selection.changed.push({ file, impact: 'regression', reason });
    } else if (impact.kind === 'features') {
      impact.dirs.flatMap(featureFilesIn).forEach((f) => files.add(f));
      selection.changed.push({ file, impact: `features: ${impact.dirs.join(', ')}`, reason });
    } else {
      selection.changed.push({ file, impact: 'none', reason });
    }
  }
  // A change to the gates themselves always gets the strongest QA suite.
  if (selection.gateDefining.length > 0) selection.kind = 'regression';
  if (selection.kind !== 'regression' && files.size > 0) {
    selection.kind = 'features';
    selection.features = [...files].sort();
  }
  return selection;
}

function node(args: string[], env: Record<string, string>): number {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return result.status ?? 1;
}

const CUCUMBER = path.join('node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js');

/**
 * Normal (not known-defect) scenarios in the selected feature files: a dry run of the "full"
 * profile on them, reported to a relative directory (no drive letter in a format option).
 */
function runnableScenarios(featureFiles: string[]): number {
  mkdirSync('reports', { recursive: true });
  const dir = path.relative(process.cwd(), mkdtempSync(path.join('reports', '.impacted-')));
  try {
    const result = spawnSync(
      process.execPath,
      [CUCUMBER, '--profile', 'full', '--dry-run', ...featureFiles],
      { env: { ...process.env, REPORTS_DIR: dir }, encoding: 'utf8' },
    );
    if (result.status !== 0)
      throw new Error(`Dry run failed:
${result.stderr || result.stdout}`);
    const report = JSON.parse(readFileSync(path.join(dir, 'cucumber-report.json'), 'utf8')) as {
      elements?: { type: string }[];
    }[];
    return report.flatMap((f) => f.elements ?? []).filter((e) => e.type === 'scenario').length;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function run(selection: Selection): void {
  const environment = process.env.TARGET_ENV || 'qa';
  const reportsDir = path.join('reports', environment, 'impacted');
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(path.join(reportsDir, 'selection.json'), `${JSON.stringify(selection, null, 2)}\n`);
  if (selection.kind === 'none') {
    console.log('IMPACTED TESTS: none beyond Smoke (documentation, lint or ignore rules only).');
    return;
  }
  if (selection.kind === 'features' && runnableScenarios(selection.features) === 0) {
    console.log(
      'IMPACTED TESTS: the selected features hold only known-defect scenarios; ' +
        'known defects never gate a change (optional Known Defects stage on main).',
    );
    return;
  }
  const cucumber = CUCUMBER;
  const coverage = path.join('scripts', 'ci', 'verify-suite-coverage.ts');
  const env = { REPORTS_DIR: reportsDir };
  let status: number;
  if (selection.kind === 'regression') {
    const expected = process.env.REGRESSION_EXPECTED ?? '24';
    status = node([cucumber, '--profile', 'regression'], env);
    if (status === 0) {
      status = node(
        [
          '--require',
          'ts-node/register',
          coverage,
          '--suite',
          'regression',
          '--expect',
          expected,
          reportsDir,
        ],
        {},
      );
    }
  } else {
    status = node([cucumber, '--profile', 'full', ...selection.features], env);
    if (status === 0) {
      status = node(
        [
          '--require',
          'ts-node/register',
          coverage,
          '--suite',
          'full',
          '--paths',
          selection.features.join(','),
          reportsDir,
        ],
        {},
      );
    }
  }
  if (status !== 0) {
    console.error('IMPACTED TESTS FAILED');
    process.exit(status);
  }
  console.log('IMPACTED TESTS OK');
}

function main(): void {
  const command = process.argv[2];
  if (command !== 'select' && command !== 'run') {
    throw new Error('Usage: impacted-tests.ts select|run [--base <ref>]');
  }
  const selection = select();
  console.log(`Changes compared with ${selection.base} (merge base):`);
  for (const change of selection.changed) {
    console.log(`  ${change.file}  ->  ${change.impact}  (${change.reason})`);
  }
  if (selection.changed.length === 0) console.log('  (no changed files)');
  console.log(
    `SELECTION: ${selection.kind}` +
      (selection.kind === 'features' ? ` (${selection.features.join(', ')})` : ''),
  );
  if (selection.gateDefining.length > 0) {
    console.log(
      `GATE-DEFINING CHANGE (${selection.gateDefining.join(', ')}): this PR changes the checks ` +
        'that validate it. Review it and merge it manually; do not enable auto-merge.',
    );
  }
  if (command === 'run') run(selection);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
