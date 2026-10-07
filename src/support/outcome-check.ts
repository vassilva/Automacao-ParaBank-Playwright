/**
 * Named outcome checks: the assertions that state a scenario's expected business outcome.
 *
 * Only a failed ASSERTION inside a check becomes an OutcomeCheckFailure. Anything else thrown
 * while checking (a transport error, a timeout of a page action, a missing scenario fact, an
 * unreadable response) propagates unchanged, so it can never be mistaken for the outcome being
 * wrong. The Playwright adapter uses this to accept a known defect only through its intended
 * proof (playwright/known-defect-proofs.ts); native Cucumber reports it like any failure.
 */
export type OutcomeCheckId =
  | 'message-shown'
  | 'required-messages-shown'
  | 'loan-denied'
  | 'registration-not-confirmed'
  | 'no-username-taken-message'
  | 'ledger-readable'
  | 'ledger-unchanged'
  | 'other-ledger-unchanged'
  | 'other-profile-unchanged'
  | 'request-refused';

/** Cucumber reports `error.constructor.name` as the exception type; the adapter relies on it. */
export class OutcomeCheckFailure extends Error {
  constructor(
    readonly check: OutcomeCheckId,
    cause: Error,
  ) {
    super(`Outcome check "${check}" failed: ${cause.message}`);
    this.name = 'OutcomeCheckFailure';
    const frames = cause.stack?.split('\n').filter((line) => /^\s+at /.test(line)) ?? [];
    this.stack = [`${this.name}: ${this.message}`, ...frames].join('\n');
  }
}

/** Reads the check id back from a reported OutcomeCheckFailure message. */
export function outcomeCheckId(message: string): string | undefined {
  return /^Outcome check "([a-z-]+)" failed: /.exec(message)?.[1];
}

/** A failed Playwright assertion carries its matcher result (Playwright's own discriminator). */
function isAssertionFailure(error: unknown): error is Error {
  return error instanceof Error && 'matcherResult' in error;
}

export async function outcomeCheck<T>(
  check: OutcomeCheckId,
  assertion: () => T | Promise<T>,
): Promise<T> {
  try {
    return await assertion();
  } catch (error) {
    if (isAssertionFailure(error)) throw new OutcomeCheckFailure(check, error);
    throw error;
  }
}
