import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Opt-in (TEST_DATA_AUDIT=true) run-time audit of generated test data: which scenario received
 * which value of each category (username, SSN, name, address, phone, payee, ...), so a value
 * generated for two scenarios is detected.
 *
 * Values are never stored or written: each one is reduced to an HMAC-SHA256 fingerprint under a
 * key that exists only in this process's memory, so the report cannot be reversed (not even for
 * the small SSN space) and contains categories, counts and scenario locations only.
 */
const enabled = process.env.TEST_DATA_AUDIT === 'true';
const key = randomBytes(32);

/** generated = new data for this scenario; provided = a value the scenario sets on purpose. */
type Origin = 'generated' | 'provided';

interface Entry {
  scenario: string;
  origin: Origin;
}

const records = new Map<string, Map<string, Entry[]>>();
let currentScenario = '(outside a scenario)';

export function setAuditScenario(scenario: string): void {
  currentScenario = scenario;
}

export function recordTestData(
  category: string,
  value: string,
  origin: Origin = 'generated',
): void {
  if (!enabled) return;
  const fingerprint = createHmac('sha256', key).update(value).digest('hex');
  const byValue = records.get(category) ?? new Map<string, Entry[]>();
  byValue.set(fingerprint, [
    ...(byValue.get(fingerprint) ?? []),
    { scenario: currentScenario, origin },
  ]);
  records.set(category, byValue);
}

/** Writes <reportsDir>/test-data-audit.json (cumulative for this process). */
export function writeTestDataAudit(reportsDir: string): void {
  if (!enabled) return;
  const categories: Record<string, unknown> = {};
  for (const [category, byValue] of [...records].sort(([a], [b]) => a.localeCompare(b))) {
    const entries = [...byValue.values()];
    const shared = entries
      .filter(
        (uses) =>
          new Set(uses.filter((u) => u.origin === 'generated').map((u) => u.scenario)).size > 1,
      )
      .map((uses) => [...new Set(uses.map((u) => u.scenario))]);
    const provided = entries
      .filter((uses) => uses.some((u) => u.origin === 'provided'))
      .map((uses) => [...new Set(uses.map((u) => u.scenario))]);
    categories[category] = {
      values: entries.reduce((sum, uses) => sum + uses.length, 0),
      distinct: entries.length,
      sharedBetweenScenarios: shared.length,
      sharedIn: shared,
      deliberatelyProvided: provided,
    };
  }
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(
    path.join(reportsDir, 'test-data-audit.json'),
    `${JSON.stringify({ note: 'fingerprints only; no values', categories }, null, 2)}\n`,
  );
}
