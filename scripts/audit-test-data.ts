/**
 * Static test-data uniqueness audit over every scenario (normal and known-defect).
 *
 *   npm run audit:test-data
 *
 * Plans all pickles through Cucumber (dry run, no browser, no environment), takes the business
 * inputs a scenario controls from its Given/When steps (amounts in "<n> dollars", quoted inputs,
 * field lengths) and lists every value used by more than one scenario. Each such repetition must
 * be classified in INTENTIONAL below with the reason it is needed; an unclassified repetition fails
 * the audit (exit 1), so unnecessary shared data cannot creep back in.
 *
 * Only feature-file literals are printed (they are in the repository already). Generated identity
 * data (usernames, passwords, SSNs, names, addresses, phones) is audited at run time without
 * printing values: src/support/test-data-audit.ts.
 */
import { PassThrough } from 'node:stream';
import { loadConfiguration, runCucumber } from '@cucumber/cucumber/api';
import { PickleStepType, type Envelope, type Pickle } from '@cucumber/messages';

type Klass =
  | 'D business constant'
  | 'E boundary'
  | 'F comparison'
  | 'G known-defect reproduction'
  | 'H application-controlled'
  | 'I harmless constant';

/** Repetitions that are needed, keyed by the normalized value (see key()). */
const INTENTIONAL: Record<string, { klass: Klass; reason: string }> = {
  'amount ""': {
    klass: 'E boundary',
    reason:
      'the empty-input partition; also a comparison pair (transfer rejected vs PB-09) and the documented PB-10 reproductions',
  },
  'input "abc"': {
    klass: 'F comparison',
    reason:
      'the normal "non-numeric transfer moves no money" and PB-09 "message never shown" use the same input by design (different oracles); "abc" is the documented PB-09 reproduction',
  },
  'amount 1.00': {
    klass: 'F comparison',
    reason:
      'minimal pair: "exactly five times the funds" (approved) and PB-11 "one cent more" differ only in the loan amount, so the down payment must be the same',
  },
  'amount 160.00': {
    klass: 'F comparison',
    reason:
      'minimal pair: "down payment equal to the funds" (accepted) and "one cent above" (refused) differ only in the down payment, so the loan amount must be the same',
  },
  'amount 100.00': {
    klass: 'G known-defect reproduction',
    reason:
      'PB-06 reproduces with the documented 100.00 loan and -10.00 down payment; PB-10 keeps its recorded companion value (only the empty field is under test)',
  },
  'amount -5.00': {
    klass: 'G known-defect reproduction',
    reason: 'the documented PB-04 (transfer) and PB-05 (bill payment) reproduction value',
  },
  'amount 0.00': {
    klass: 'E boundary',
    reason: 'zero: the PB-07 boundary, reproduced on two different endpoints (transfer, bill pay)',
  },
  'amount 0.001': {
    klass: 'E boundary',
    reason: 'sub-cent precision: the PB-08 boundary, reproduced on two different endpoints',
  },
};

interface Use {
  value: string;
  scenario: string;
  knownDefect: boolean;
}

const MONEY = /(-?\d+(?:\.\d+)?) dollars?\b/g;
const QUOTED = /"([^"]*)"/g;
const LENGTH = /of (?:exactly )?(\d+) characters/g;

/** Same amount written differently ("100" and "100.00") is the same value. */
function key(kind: string, raw: string): string {
  if (kind === 'amount' && /^-?\d+(\.\d+)?$/.test(raw)) {
    return `amount ${Number(raw).toFixed(raw.includes('.') && raw.split('.')[1]!.length > 2 ? 3 : 2)}`;
  }
  return `${kind} "${raw}"`;
}

async function pickles(): Promise<Pickle[]> {
  const stdout = new PassThrough();
  stdout.resume();
  const environment = { cwd: process.cwd(), stdout, stderr: process.stderr, env: process.env };
  const { runConfiguration } = await loadConfiguration({ profiles: ['full'] }, environment);
  const found: Pickle[] = [];
  const result = await runCucumber(
    {
      ...runConfiguration,
      sources: { ...runConfiguration.sources, tagExpression: '' },
      runtime: { ...runConfiguration.runtime, dryRun: true, parallel: 0 },
      formats: { ...runConfiguration.formats, stdout: 'summary', files: {}, publish: false },
    },
    environment,
    (envelope: Envelope) => {
      if (envelope.pickle) found.push(envelope.pickle);
    },
  );
  if (!result.success) throw new Error('Cucumber dry run failed');
  return found;
}

async function main(): Promise<void> {
  const all = await pickles();
  const uses: Use[] = [];
  for (const pickle of all) {
    const line = pickle.location?.line ?? 0;
    const scenario = `${pickle.uri.replace(/\\/g, '/').replace(/^features\//, '')}:${line}`;
    const knownDefect = pickle.tags.some((tag) => tag.name === '@known-defect');
    for (const step of pickle.steps) {
      // Inputs only: Given/When (Context/Action). Then steps hold expected outcomes.
      if (step.type !== PickleStepType.CONTEXT && step.type !== PickleStepType.ACTION) continue;
      for (const [, raw] of step.text.matchAll(MONEY)) {
        if (raw) uses.push({ value: key('amount', raw), scenario, knownDefect });
      }
      for (const [, raw] of step.text.matchAll(QUOTED)) {
        uses.push({
          value: key(/^-?[\d.]*$/.test(raw ?? '') ? 'amount' : 'input', raw ?? ''),
          scenario,
          knownDefect,
        });
      }
      for (const [, raw] of step.text.matchAll(LENGTH)) {
        if (raw) uses.push({ value: key('length', raw), scenario, knownDefect });
      }
    }
  }

  const byValue = new Map<string, Set<string>>();
  for (const use of uses) {
    byValue.set(use.value, (byValue.get(use.value) ?? new Set()).add(use.scenario));
  }
  const repeated = [...byValue].filter(([, scenarios]) => scenarios.size > 1);
  const unclassified = repeated.filter(([value]) => !INTENTIONAL[value]);

  console.log(
    `Scenarios audited: ${all.length} (${all.filter((p) => p.tags.some((t) => t.name === '@known-defect')).length} known-defect).`,
  );
  console.log(
    `Scenario-controlled input values: ${uses.length} uses, ${byValue.size} distinct; ` +
      `repeated across scenarios: ${repeated.length} (classified ${repeated.length - unclassified.length}, unclassified ${unclassified.length}).`,
  );
  for (const [value, scenarios] of repeated.sort((a, b) => b[1].size - a[1].size)) {
    const intent = INTENTIONAL[value];
    console.log(
      `  ${intent ? 'KEEP' : 'FIX '} ${value} x${scenarios.size}` +
        (intent ? ` [${intent.klass}] ${intent.reason}` : '') +
        `\n         ${[...scenarios].join(', ')}`,
    );
  }
  for (const value of Object.keys(INTENTIONAL)) {
    if (!repeated.some(([v]) => v === value))
      console.log(`  (stale exception, no longer repeated: ${value})`);
  }
  if (unclassified.length > 0) {
    console.error(`TEST-DATA AUDIT FAILED: ${unclassified.length} unclassified repetition(s).`);
    process.exit(1);
  }
  console.log('TEST-DATA AUDIT OK: every repeated scenario input is intentional.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
