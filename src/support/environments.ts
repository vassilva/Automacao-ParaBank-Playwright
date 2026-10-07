/**
 * The controlled ParaBank environments: the single definition used by the test configuration
 * (src/support/config.ts), the environment tooling (scripts/environment.ts) and Jenkins.
 *
 * Each one is its own Docker Compose project (compose.yaml): its own container, its own embedded
 * database, its own loopback port. They run the same immutable image, promoted by image ID:
 * built once, deployed to QA, then the very same image ID deployed to UAT.
 */
export const ENVIRONMENTS = {
  qa: { port: 8090 },
  uat: { port: 8091 },
} as const;

export type EnvironmentName = keyof typeof ENVIRONMENTS;

export function isEnvironmentName(name: string): name is EnvironmentName {
  return Object.hasOwn(ENVIRONMENTS, name);
}

export const composeProject = (name: string): string => `parabank-${name}`;

export const localBaseUrl = (name: EnvironmentName): string =>
  `http://localhost:${ENVIRONMENTS[name].port}/parabank/`;
