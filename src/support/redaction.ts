/**
 * Removes sensitive values from text before it becomes persistent evidence (Cucumber and
 * Playwright reports, JUnit, attachments). Functional assertions are not affected: tests still
 * compare real values; only the messages describing a failure are sanitized.
 *
 * Two layers:
 * - known values: the synthetic credentials and identity numbers of the scenario's customers;
 * - patterns: anything shaped like a session id, cookie or authorization header, or a credential
 *   query parameter. Playwright's API call log, for example, prints request headers (including
 *   `cookie`) when a request fails at transport level.
 */
const MASK = '[REDACTED]';

const PATTERNS: [RegExp, string][] = [
  // Header lines in Playwright call logs and HTTP dumps.
  [/\b(cookie|set-cookie|authorization|proxy-authorization)(\s*[:=]\s*)[^\n\r]*/gi, `$1$2${MASK}`],
  // Servlet session ids in URLs (ParaBank rewrites URLs with ;jsessionid=...) and cookies.
  [/(jsessionid=)[^;?&#\s"'/\\]+/gi, `$1${MASK}`],
  // Credential and identity parameters in query strings and form bodies.
  [/\b((?:customer\.)?(?:password|repeatedPassword|username|ssn)=)[^&\s"']*/gi, `$1${MASK}`],
  // The synthetic SSN range used by this suite (000-xx-xxxx), wherever it appears.
  [/\b000-\d{2}-\d{4}\b/g, MASK],
  // Shapes of the credentials src/factories/customer.factory.ts generates (password "Pw" + 16
  // base64url characters, or a few more for a deliberately wrong one; username "qa" + lowercase
  // letters and digits), as a safety net for a value that was somehow not registered below.
  [/(?<![\w-])Pw[\w-]{16,24}(?![\w-])/g, MASK],
  [/(?<![\w-])qa[0-9a-z]{10,30}(?![\w-])/g, MASK],
];

/**
 * Every credential and identity value generated during this process, registered when it is
 * created (customer.factory.ts), so it is masked wherever it later appears, even if no step stored
 * it in the World. Synthetic values only; kept in memory, never written anywhere.
 */
const generated: string[] = [];

export function protectValues(...values: (string | undefined)[]): void {
  for (const value of values) if (value) generated.push(value);
}

/** Position in the registry, to read back what one scenario generated (see protectedSince). */
export function protectedCount(): number {
  return generated.length;
}

export function protectedSince(mark: number): string[] {
  return generated.slice(mark);
}

/** Shortest value treated as a secret: shorter strings would mask ordinary words. */
const MIN_SECRET_LENGTH = 4;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redact(text: string, secrets: readonly (string | undefined)[] = []): string {
  let result = text;
  const known = [...new Set([...secrets, ...generated])]
    .filter((s): s is string => typeof s === 'string' && s.trim().length >= MIN_SECRET_LENGTH)
    // Longest first, so a secret containing another one is masked whole.
    .sort((a, b) => b.length - a.length);
  for (const secret of known) {
    result = result.replace(new RegExp(escapeRegExp(secret), 'g'), MASK);
  }
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Sanitizes an error in place (message and stack), keeping its type for the reporters. */
export function redactError(
  error: unknown,
  secrets: readonly (string | undefined)[] = [],
): unknown {
  if (error instanceof Error) {
    error.message = redact(error.message, secrets);
    if (error.stack) error.stack = redact(error.stack, secrets);
    return error;
  }
  return typeof error === 'string' ? redact(error, secrets) : error;
}
