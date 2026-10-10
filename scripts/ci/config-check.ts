/**
 * Configuration check for Configurator pushes (config/* branches): validates the environment
 * configuration without building an image or deploying anything.
 *
 *   ts-node scripts/ci/config-check.ts
 *
 * 1. compose.yaml renders for every environment of src/support/environments.ts, with the project,
 *    loopback port and image that scripts/environment.ts would pass.
 * 2. compose.yaml refuses to render without an image (no silent default image).
 * 3. Environments have distinct Compose projects and distinct ports.
 */
import { spawnSync } from 'node:child_process';
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

function main(): void {
  const problems: string[] = [];
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
    `CONFIG CHECK OK: ${names.length} environments, distinct projects and ports, image required.`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
