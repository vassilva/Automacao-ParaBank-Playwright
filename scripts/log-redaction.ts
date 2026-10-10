/**
 * Redaction for every log this project prints or archives that it does not author itself: the
 * ParaBank container logs (scripts/environment.ts) and the ParaBank image build output
 * (scripts/build-parabank-image.ts), which reaches both the Jenkins console and
 * build/parabank-build.log.
 *
 * ParaBank logs customers in clear text ("username=..., password=..., ssn=..."): the synthetic
 * customers of this suite, and the vendor's demo customer and sample SSNs printed by ParaBank's own
 * tests during the build. Every line is redacted before it is written anywhere; a line that still
 * looks like it carries a credential afterwards is withheld entirely. A log is therefore never
 * dropped (diagnostics stay) and never leaks.
 */
const MASK = '[REDACTED]';
const VALUE = String.raw`[^\s,;\]&"'<>)]+`;

const RULES: [RegExp, string][] = [
  // key=value and key: value (ParaBank's Customer/User toString, form and query parameters).
  [
    new RegExp(String.raw`\b(password|repeatedPassword|username|ssn)(\s*[=:]\s*)${VALUE}`, 'gi'),
    `$1$2${MASK}`,
  ],
  // JSON fields.
  [/("(?:password|repeatedPassword|username|ssn)"\s*:\s*")[^"]*/gi, `$1${MASK}`],
  // Session ids and authorization material.
  [/(jsessionid=)[A-Za-z0-9.]+/gi, `$1${MASK}`],
  [/\b(cookie|set-cookie|authorization)(\s*[:=]\s*)[^\r\n]*/gi, `$1$2${MASK}`],
  // Shapes of this suite's generated credentials (src/factories/test-data.ts, customer.factory.ts).
  [/(?<![\w-])Pw[\w-]{16,24}(?![\w-])/g, MASK],
  [/(?<![\w-])qa[0-9a-z]{10,30}(?![\w-])/g, MASK],
  // Anything SSN-shaped (the suite's 000 area and ParaBank's sample SSNs alike).
  [/\b\d{3}-\d{2}-\d{4}\b/g, MASK],
];

/** A credential field whose value survived redaction. */
const LEFTOVER = new RegExp(
  String.raw`\b(password|repeatedPassword|username|ssn)\s*[=:]\s*(?!\[REDACTED\])[^\s,;\]&"'<>)]`,
  'i',
);

const WITHHELD = '[line withheld: it may contain a credential]';

export function redactLogLine(line: string): string {
  const redacted = RULES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    line,
  );
  return LEFTOVER.test(redacted) ? WITHHELD : redacted;
}

export function redactLog(text: string): string {
  return text.split('\n').map(redactLogLine).join('\n');
}

/** Line-buffered redaction for streamed output: a value split across chunks is still masked. */
export function lineRedactor(write: (text: string) => void) {
  let pending = '';
  return {
    push(chunk: Buffer | string): void {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) write(`${redactLogLine(line)}\n`);
    },
    flush(): void {
      if (pending) write(redactLogLine(pending));
      pending = '';
    },
  };
}
