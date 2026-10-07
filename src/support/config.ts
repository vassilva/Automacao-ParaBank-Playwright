import { existsSync } from 'node:fs';
import { ENVIRONMENTS, isEnvironmentName, localBaseUrl } from './environments';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * The target is chosen by configuration only; the same features, steps and page objects run
 * against any environment:
 *   TARGET_ENV=qa   (default)  http://localhost:8090/parabank/
 *   TARGET_ENV=uat             http://localhost:8091/parabank/
 * PARABANK_BASE_URL overrides the address for the selected environment (Jenkins reaches the
 * containers by name on their Docker network, not through the host's loopback port).
 */
function resolveTarget(): { name: string; baseURL: string } {
  const name = (process.env.TARGET_ENV ?? 'qa').trim().toLowerCase();
  if (!isEnvironmentName(name)) {
    throw new Error(`Unknown TARGET_ENV "${name}". Use ${Object.keys(ENVIRONMENTS).join(' or ')}.`);
  }
  const explicit = process.env.PARABANK_BASE_URL?.trim();
  return { name, baseURL: normalizeBaseUrl(explicit || localBaseUrl(name)) };
}

const target = resolveTarget();

export const config = {
  targetEnv: target.name,
  baseURL: target.baseURL,
  headless: process.env.HEADLESS !== 'false',
  slowMo: Number(process.env.SLOW_MO ?? 0),
  traceOnFailure: process.env.PW_TRACE_ON_FAILURE === 'true',
  /** Opt-in request accounting for rate-limit investigations (reports/network-diagnostics.jsonl). */
  networkDiagnostics: process.env.NET_DIAG === 'true',
  reportsDir: process.env.REPORTS_DIR || 'reports',
  timeouts: {
    /** Whole scenario: includes provisioning a customer. */
    scenario: 120_000,
    action: 15_000,
    navigation: 30_000,
    assertion: 10_000,
  },
} as const;
