/**
 * Configuration check for Configurator pushes (config/* branches) and every pull request:
 * validates the configuration without building an image or deploying anything. Values are never
 * printed.
 *
 *   ts-node scripts/ci/config-check.ts
 *
 * 1. compose.yaml renders for every environment of src/support/environments.ts, with the project,
 *    loopback port and image that scripts/environment.ts would pass.
 * 2. compose.yaml refuses to render without an image (no silent default image).
 * 3. Environments have distinct Compose projects and distinct ports.
 * 4. docker/parabank/source.env: exactly the official HTTPS repository and one immutable 40-hex
 *    commit (never a branch name).
 * 5. .env.example: only keys the code reads, and the CI-relevant defaults are the safe ones (one
 *    worker, no retries, no traces, a known environment).
 * ParaBank's business rules are not configurable from this repository, so there is no business-rule
 * configuration to validate here; the application's behaviour is covered by the suites.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ENVIRONMENTS, composeProject, type EnvironmentName } from '../../src/support/environments';

const PROBE_IMAGE = `sha256:${'0'.repeat(64)}`;

interface Rendered {
  name: string;
  services: Record<string, { image?: string; ports?: { host_ip?: string; published?: string }[] }>;
}

function compose(env: Record<string, string>) {
  return spawnSync('docker', ['compose', 'config', '--format', 'json'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

/** KEY=value lines of a dotenv-style file; comments and blank lines are ignored. */
function readEnvFile(file: string): { entries: Map<string, string>; malformed: number } {
  const entries = new Map<string, string>();
  let malformed = 0;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] !== undefined) entries.set(match[1], match[2] ?? '');
    else if (line.trim() && !line.trim().startsWith('#')) malformed += 1;
  }
  return { entries, malformed };
}

function checkSourceEnv(problems: string[]): void {
  const file = 'docker/parabank/source.env';
  const { entries, malformed } = readEnvFile(file);
  if (malformed > 0) problems.push(`${file}: ${malformed} malformed line(s)`);
  if ([...entries.keys()].sort().join(',') !== 'PARABANK_SOURCE_COMMIT,PARABANK_SOURCE_REPO') {
    problems.push(`${file}: keys must be exactly PARABANK_SOURCE_REPO and PARABANK_SOURCE_COMMIT`);
  }
  if (
    !/^https:\/\/github\.com\/parasoft\/parabank(\.git)?$/.test(
      entries.get('PARABANK_SOURCE_REPO') ?? '',
    )
  ) {
    problems.push(`${file}: PARABANK_SOURCE_REPO is not the official HTTPS repository`);
  }
  if (!/^[0-9a-f]{40}$/.test(entries.get('PARABANK_SOURCE_COMMIT') ?? '')) {
    problems.push(`${file}: PARABANK_SOURCE_COMMIT is not a full 40-hex commit`);
  }
}

/** Keys read by the test code (src/support/config.ts, cucumber.js, the Playwright adapter). */
const KNOWN_KEYS = [
  'TARGET_ENV',
  'PARABANK_BASE_URL',
  'HEADLESS',
  'SLOW_MO',
  'CUCUMBER_PARALLEL',
  'CUCUMBER_RETRY',
  'PW_TRACE_ON_FAILURE',
  'NET_DIAG',
  'REPORTS_DIR',
  'TEST_DATA_AUDIT',
];

function checkEnvExample(problems: string[]): void {
  const file = '.env.example';
  const { entries, malformed } = readEnvFile(file);
  if (malformed > 0) problems.push(`${file}: ${malformed} malformed line(s)`);
  for (const key of entries.keys()) {
    if (!KNOWN_KEYS.includes(key)) problems.push(`${file}: ${key} is not read by the code`);
  }
  const rule = (key: string, ok: (value: string) => boolean, expected: string) => {
    const value = entries.get(key);
    if (value !== undefined && !ok(value)) problems.push(`${file}: ${key} must be ${expected}`);
  };
  rule('CUCUMBER_PARALLEL', (v) => v === '1', '1 (ParaBank registration is not concurrency-safe)');
  rule('CUCUMBER_RETRY', (v) => v === '0', '0 (no retries)');
  rule('PW_TRACE_ON_FAILURE', (v) => v === 'false', 'false (traces capture credentials)');
  rule(
    'TARGET_ENV',
    (v) => Object.hasOwn(ENVIRONMENTS, v),
    `one of: ${Object.keys(ENVIRONMENTS).join(', ')}`,
  );
}

function main(): void {
  const problems: string[] = [];
  checkSourceEnv(problems);
  checkEnvExample(problems);
  const names = Object.keys(ENVIRONMENTS) as EnvironmentName[];

  for (const environment of names) {
    const port = String(ENVIRONMENTS[environment].port);
    const result = compose({
      PARABANK_ENV: environment,
      PARABANK_PORT: port,
      PARABANK_IMAGE: PROBE_IMAGE,
    });
    if (result.status !== 0) {
      problems.push(`${environment}: compose.yaml does not render: ${result.stderr.trim()}`);
      continue;
    }
    const rendered = JSON.parse(result.stdout) as Rendered;
    const service = rendered.services.parabank;
    const published = service?.ports?.[0];
    if (rendered.name !== composeProject(environment)) {
      problems.push(
        `${environment}: project is ${rendered.name}, expected ${composeProject(environment)}`,
      );
    }
    if (service?.image !== PROBE_IMAGE)
      problems.push(`${environment}: image is not the one passed in`);
    if (published?.published !== port)
      problems.push(`${environment}: published port is not ${port}`);
    if (published?.host_ip !== '127.0.0.1')
      problems.push(`${environment}: port is not bound to loopback`);
    console.log(
      `${environment}: renders as project ${rendered.name}, 127.0.0.1:${published?.published}`,
    );

    const withoutImage = compose({
      PARABANK_ENV: environment,
      PARABANK_PORT: port,
      PARABANK_IMAGE: '',
    });
    if (withoutImage.status === 0)
      problems.push(`${environment}: compose.yaml renders without an image`);
  }

  const ports = names.map((name) => ENVIRONMENTS[name].port);
  if (new Set(ports).size !== ports.length)
    problems.push(`environments share a port: ${ports.join(', ')}`);
  const projects = names.map(composeProject);
  if (new Set(projects).size !== projects.length)
    problems.push('environments share a Compose project');

  if (problems.length > 0) {
    throw new Error(`CONFIG CHECK FAILED:\n  ${problems.join('\n  ')}`);
  }
  console.log(
    `CONFIG CHECK OK: ${names.length} environments, distinct projects and ports, image required; ` +
      'source.env pinned to the official repository; .env.example keys known and defaults safe.',
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
