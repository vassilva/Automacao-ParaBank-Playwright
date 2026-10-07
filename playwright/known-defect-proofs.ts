/**
 * How a @known-defect scenario is judged by the Playwright adapter.
 *
 * Each confirmed defect (docs/defects.md) names the outcome check(s) that prove it: the assertion
 * stating the correct behavior that the defect breaks (src/support/outcome-check.ts). A scenario
 * counts as "defect reproduced" only when it fails through exactly that proof; any other failure
 * is reported as a real failure, and a pass as "no longer reproduces".
 */
import {
  OutcomeCheckFailure,
  outcomeCheckId,
  type OutcomeCheckId,
} from '../src/support/outcome-check';
import type { ScenarioOutcome } from './cucumber-runtime';

export const KNOWN_DEFECT_PROOFS: Readonly<Record<string, readonly OutcomeCheckId[]>> = {
  // Another customer's own data is returned instead of a refusal.
  'PB-01': ['request-refused'],
  // The other customer's persisted ledger changes.
  'PB-02': ['other-ledger-unchanged'],
  // The other customer's persisted profile changes.
  'PB-03': ['other-profile-unchanged'],
  // Money moves (PB-04, PB-05, PB-06) or $0.00 entries are posted (PB-07).
  'PB-04': ['ledger-unchanged'],
  'PB-05': ['ledger-unchanged'],
  'PB-06': ['ledger-unchanged'],
  'PB-07': ['ledger-unchanged'],
  // The bank answers the customer's accounts with an application error (HTTP 5xx) afterwards.
  'PB-08': ['ledger-readable'],
  'PB-09': ['message-shown'],
  'PB-10': ['message-shown'],
  'PB-11': ['loan-denied'],
  'PB-12': ['message-shown'],
  'PB-14': ['message-shown'],
  'PB-15': ['registration-not-confirmed'],
  'PB-16': ['message-shown', 'required-messages-shown'],
  'PB-17': ['no-username-taken-message'],
};

export type KnownDefectVerdict =
  | { verdict: 'reproduced'; check: string }
  | { verdict: 'no-longer-reproduces' }
  | { verdict: 'not-the-defect'; reason: string };

const PASSED = 'PASSED';
const FAILED = 'FAILED';
const SKIPPED = 'SKIPPED';

/**
 * Reproduced only if: every step before the failure passed; the first non-passed step is a Then
 * (Outcome) step with status FAILED; it failed through an OutcomeCheckFailure whose check is a
 * registered proof of this defect; and everything after it was skipped (hooks must pass).
 * Undefined, pending, ambiguous and skipped steps, setup, action, hook, transport and timeout
 * failures, and assertions that are not the defect's proof, are never a reproduction.
 */
export function judgeKnownDefect(defectId: string, outcome: ScenarioOutcome): KnownDefectVerdict {
  const proofs = KNOWN_DEFECT_PROOFS[defectId];
  if (!proofs) return { verdict: 'not-the-defect', reason: `${defectId} has no registered proof` };
  const steps = outcome.steps;
  if (outcome.status === PASSED && steps.length > 0 && steps.every((s) => s.status === PASSED)) {
    return { verdict: 'no-longer-reproduces' };
  }
  const index = steps.findIndex((step) => step.status !== PASSED);
  const failed = steps[index];
  if (!failed) return { verdict: 'not-the-defect', reason: 'no failed step was reported' };
  if (failed.status !== FAILED) {
    return { verdict: 'not-the-defect', reason: `a ${failed.kind} step is ${failed.status}` };
  }
  if (failed.kind !== 'Outcome') {
    return { verdict: 'not-the-defect', reason: `a ${failed.kind} step failed before any Then` };
  }
  const after = steps.slice(index + 1);
  const unexpected = after.find((s) =>
    s.kind === 'Hook' ? s.status !== PASSED : s.status !== SKIPPED,
  );
  if (unexpected) {
    return {
      verdict: 'not-the-defect',
      reason: `a ${unexpected.kind} step after the failure is ${unexpected.status}`,
    };
  }
  if (failed.exceptionType !== OutcomeCheckFailure.name) {
    return {
      verdict: 'not-the-defect',
      reason: `the Then step threw ${failed.exceptionType ?? 'no exception'}, not a failed outcome check`,
    };
  }
  const check = outcomeCheckId(failed.exceptionMessage ?? '');
  if (!check || !(proofs as readonly string[]).includes(check)) {
    return {
      verdict: 'not-the-defect',
      reason: `outcome check "${check ?? 'unknown'}" failed; ${defectId} is proven by ${proofs.join(' or ')}`,
    };
  }
  return { verdict: 'reproduced', check };
}
