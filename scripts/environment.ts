/**
 * Lifecycle of the controlled ParaBank environments QA and UAT (src/support/environments.ts),
 * locally and in Jenkins. Each one is its own Compose project, container and embedded database.
 *
 *   ts-node scripts/environment.ts deploy   <qa|uat> [image ID]  fresh container from that image
 *   ts-node scripts/environment.ts start    <qa|uat>             start the stopped environment
 *   ts-node scripts/environment.ts stop     <qa|uat>             stop it (state is kept)
 *   ts-node scripts/environment.ts status   <qa|uat>             container, health, image ID
 *   ts-node scripts/environment.ts health   <qa|uat> [--wait]    container healthy + app serving
 *   ts-node scripts/environment.ts identity <qa|uat> [--expect <image ID>]
 *   ts-node scripts/environment.ts identity --same [--expect <image ID>]   QA and UAT
 *   ts-node scripts/environment.ts teardown <qa|uat> [--keep-running]     CI: save log, detach
 *
 * BUILD ONCE, PROMOTE THE SAME IMAGE: deploy takes an immutable image ID (sha256:...), by default
 * the one recorded by the last `npm run app:build` (build/parabank-image.json). Deploying QA and
 * then UAT with the same ID is the promotion; nothing is rebuilt for UAT. Identity is always read
 * back from Docker metadata (the image ID the container runs), never inferred from a tag.
 *
 * In a Jenkins container agent the host's loopback port is not reachable: deploy attaches the
 * agent to the environment's Docker network, where ParaBank is reachable by container name.
 * ParaBank logs passwords and SSNs in clear text, so teardown saves its log redacted only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { redactLog } from './log-redaction';
import {
  ENVIRONMENTS,
  composeProject,
  isEnvironmentName,
  localBaseUrl,
  type EnvironmentName,
} from '../src/support/environments';

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const BUILD_RECORD = path.join('build', 'parabank-image.json');

/** True when this process runs inside a container (the Jenkins docker agent). */
const inContainer = existsSync('/.dockerenv');

function names(environment: EnvironmentName) {
  const project = composeProject(environment);
  return { project, network: `${project}_default`, container: `${project}-parabank-1` };
}

/** Where the tests reach the environment from this process. */
function baseUrl(environment: EnvironmentName): string {
  return inContainer
    ? `http://${names(environment).container}:8080/parabank/`
    : localBaseUrl(environment);
}

function docker(args: string[], env: Record<string, string> = {}, quiet = false): string {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', quiet ? 'pipe' : 'inherit'],
  });
  if (result.status !== 0) {
    throw new Error(`docker ${args.slice(0, 3).join(' ')} failed (exit ${result.status})`);
  }
  return result.stdout.trim();
}

const succeeds = (args: string[]) => spawnSync('docker', args, { stdio: 'ignore' }).status === 0;

function recordedImageId(): string {
  if (!existsSync(BUILD_RECORD)) {
    throw new Error(`No image ID given and no build record (${BUILD_RECORD}): npm run app:build`);
  }
  return (JSON.parse(readFileSync(BUILD_RECORD, 'utf8')) as { imageId: string }).imageId;
}

/** Compose needs every variable of compose.yaml, even for commands that ignore the image. */
function composeEnv(environment: EnvironmentName, imageId = 'sha256:none') {
  return {
    PARABANK_ENV: environment,
    PARABANK_PORT: String(ENVIRONMENTS[environment].port),
    PARABANK_IMAGE: imageId,
  };
}

interface Status {
  environment: EnvironmentName;
  container: string;
  state: string;
  health: string;
  imageId: string;
  port: number;
}

function status(environment: EnvironmentName): Status {
  const { container } = names(environment);
  const base = { environment, container, port: ENVIRONMENTS[environment].port };
  if (!succeeds(['container', 'inspect', container])) {
    return { ...base, state: 'absent', health: 'none', imageId: '' };
  }
  const [info] = JSON.parse(docker(['container', 'inspect', container], {}, true)) as {
    Image: string;
    State: { Status: string; Health?: { Status: string } };
  }[];
  return {
    ...base,
    state: info?.State.Status ?? 'unknown',
    health: info?.State.Health?.Status ?? 'none',
    imageId: info?.Image ?? '',
  };
}

function deploy(environment: EnvironmentName, imageId: string): void {
  if (!IMAGE_ID.test(imageId)) {
    throw new Error(`deploy needs a full image ID (sha256:<64 hex>), got "${imageId}"`);
  }
  console.log(`Deploying image ${imageId} to ${environment.toUpperCase()} (fresh container)`);
  docker(
    ['compose', 'up', '--detach', '--wait', '--wait-timeout', '180', '--force-recreate'],
    composeEnv(environment, imageId),
  );
  // A deployment is complete only when the environment is usable (database initialized).
  health(environment, true);
  identity(environment, imageId);
}

/**
 * A containerized Jenkins agent reaches an environment through its Compose network. Idempotent;
 * also used when a pipeline validates an environment it did not deploy (scripts/ci/app-image.ts).
 */
function attachAgent(environment: EnvironmentName): void {
  if (!inContainer) return;
  const { network, container } = names(environment);
  if (!succeeds(['network', 'inspect', network])) return;
  const attached = docker(['network', 'inspect', network, '--format', '{{json .Containers}}']);
  if (!attached.includes(hostname())) docker(['network', 'connect', network, hostname()]);
  console.log(`Agent attached to ${network}; ParaBank at http://${container}:8080/parabank/`);
}

/** Polls the container's own healthcheck (an observable condition), bounded by 180 s. */
function waitUntilHealthy(environment: EnvironmentName): Status {
  const deadline = Date.now() + 180_000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let current = status(environment);
  while (current.state === 'running' && current.health === 'starting' && Date.now() < deadline) {
    Atomics.wait(pause, 0, 0, 2_000);
    current = status(environment);
  }
  return current;
}

/**
 * ParaBank creates its database lazily (IndexController, on home-page requests such as the
 * healthcheck's): the container reports "healthy" up to ~30 s before registration works, and a
 * registration in that window fails with HTTP 500 ("object not found: SEQUENCE"). Ready means the
 * application logged "Database initialized" since this container started. The log holds
 * credentials in clear text: it is only searched for that line, never printed or stored.
 */
function databaseInitialized(environment: EnvironmentName): boolean {
  const { container } = names(environment);
  const started = docker(['container', 'inspect', '--format', '{{.State.StartedAt}}', container]);
  const logs = spawnSync('docker', ['logs', '--since', started, container], { encoding: 'utf8' });
  const text = `${logs.stdout}${logs.stderr}`;
  // Called after a complete home-page request: a fresh database logs "not yet initialized" on that
  // request and is ready once "Database initialized" follows; a database kept across a restart
  // logs neither, because it already exists.
  return text.includes('Database initialized') || !text.includes('Database not yet initialized');
}

/** Polls for the application's own "Database initialized" log line, bounded by 180 s. */
function waitUntilDatabaseInitialized(environment: EnvironmentName): boolean {
  const deadline = Date.now() + 180_000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let ready = databaseInitialized(environment);
  while (!ready && Date.now() < deadline) {
    Atomics.wait(pause, 0, 0, 2_000);
    ready = databaseInitialized(environment);
  }
  return ready;
}

function health(environment: EnvironmentName, wait: boolean): void {
  attachAgent(environment);
  const current = wait ? waitUntilHealthy(environment) : status(environment);
  console.log(JSON.stringify(current));
  if (current.state !== 'running' || current.health !== 'healthy') {
    throw new Error(
      `${environment.toUpperCase()} is not healthy (state ${current.state}, health ${current.health})`,
    );
  }
  // The application itself, through the same check the test runners use before any scenario.
  // Its complete home-page request is also what makes ParaBank initialize its database (the
  // container healthcheck's bare HTTP/1.0 probe triggers the initialization but never completes it).
  const check = spawnSync(
    process.execPath,
    ['--require', 'ts-node/register', 'scripts/check-target.ts', ...(wait ? ['--wait'] : [])],
    {
      stdio: 'inherit',
      env: { ...process.env, TARGET_ENV: environment, PARABANK_BASE_URL: baseUrl(environment) },
    },
  );
  if (check.status !== 0) throw new Error(`${environment.toUpperCase()} application check failed`);
  const initialized = wait
    ? waitUntilDatabaseInitialized(environment)
    : databaseInitialized(environment);
  if (!initialized) {
    throw new Error(`${environment.toUpperCase()} database is not initialized yet`);
  }
  console.log(`${environment.toUpperCase()} READY (database initialized)`);
}

/** Fails unless the environment runs, healthy, exactly the expected image ID. */
function identity(environment: EnvironmentName, expected?: string): string {
  const current = status(environment);
  console.log(
    `${environment.toUpperCase()} IMAGE ID ${current.imageId || '(none)'} (${current.state}, ${current.health})`,
  );
  if (expected !== undefined) {
    if (!IMAGE_ID.test(expected))
      throw new Error(`--expect needs a full image ID, got "${expected}"`);
    if (current.imageId !== expected) {
      throw new Error(
        `IMAGE IDENTITY MISMATCH: ${environment.toUpperCase()} runs ${current.imageId || 'nothing'}, expected ${expected}`,
      );
    }
    console.log(`IMAGE IDENTITY OK: ${environment.toUpperCase()} runs ${expected}`);
  }
  return current.imageId;
}

function saveLog(environment: EnvironmentName): void {
  const dir = path.join(process.env.REPORTS_DIR || 'reports', 'logs');
  mkdirSync(dir, { recursive: true });
  const raw = docker(
    ['compose', 'logs', '--no-color', '--timestamps', 'parabank'],
    composeEnv(environment),
  );
  // ParaBank logs customers in clear text (usernames, passwords, SSNs): redacted line by line, and
  // any line that still looks like a credential is withheld (scripts/log-redaction.ts).
  const safe = redactLog(raw);
  const file = path.join(dir, `${environment}.log`);
  writeFileSync(file, safe);
  console.log(`Saved redacted ParaBank log: ${file}`);
}

function teardown(environment: EnvironmentName, keepRunning: boolean): void {
  const { network, container } = names(environment);
  if (succeeds(['container', 'inspect', container])) saveLog(environment);
  if (inContainer && succeeds(['network', 'inspect', network])) {
    const attached = docker(['network', 'inspect', network, '--format', '{{json .Containers}}']);
    if (attached.includes(hostname()))
      docker(['network', 'disconnect', '--force', network, hostname()]);
  }
  if (keepRunning) {
    console.log(`${environment.toUpperCase()} left running.`);
    return;
  }
  docker(['compose', 'down', '--remove-orphans'], composeEnv(environment));
  console.log(`${environment.toUpperCase()} removed.`);
}

function environmentArg(value: string | undefined): EnvironmentName {
  if (!value || !isEnvironmentName(value)) {
    throw new Error(
      `Expected an environment (${Object.keys(ENVIRONMENTS).join(' or ')}), got "${value ?? ''}"`,
    );
  }
  return value;
}

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index === -1 ? undefined : args[index + 1];
}

function main(): void {
  const [command, target, ...rest] = process.argv.slice(2);
  const args = [target ?? '', ...rest];
  switch (command) {
    case 'deploy':
      return deploy(environmentArg(target), rest[0] ?? recordedImageId());
    case 'start':
      docker(['compose', 'start'], composeEnv(environmentArg(target)));
      return health(environmentArg(target), true);
    case 'stop':
      docker(['compose', 'stop'], composeEnv(environmentArg(target)));
      console.log(JSON.stringify(status(environmentArg(target))));
      return;
    case 'status':
      console.log(JSON.stringify(status(environmentArg(target)), null, 2));
      return;
    case 'health':
      return health(environmentArg(target), rest.includes('--wait'));
    case 'identity': {
      const expected = optionValue(args, '--expect');
      if (args.includes('--same')) {
        const qa = identity('qa', expected);
        const uat = identity('uat', expected);
        if (!qa || qa !== uat) throw new Error(`IMAGE IDENTITY MISMATCH: QA ${qa}, UAT ${uat}`);
        console.log(`IMAGE IDENTITY OK: QA and UAT run the same image ${qa}`);
        return;
      }
      identity(environmentArg(target), expected);
      return;
    }
    case 'teardown':
      return teardown(environmentArg(target), rest.includes('--keep-running'));
    default:
      throw new Error(
        'Usage: environment.ts deploy|start|stop|status|health|identity|teardown <qa|uat> [...]',
      );
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
