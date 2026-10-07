/**
 * Monetary values are integer cents. Expected values are computed with integer arithmetic only;
 * floating point is used solely to read the JSON numbers ParaBank returns, and those are rejected
 * if they carry precision finer than a cent instead of being silently rounded.
 */
export type Cents = number;

const DECIMAL_AMOUNT = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/** Exact parse of a plain decimal string such as "100", "0.01" or "42.1" (no symbols or commas). */
export function parseAmount(text: string): Cents {
  const match = DECIMAL_AMOUNT.exec(text.trim());
  if (!match) throw new Error(`Not a plain decimal amount: "${text}"`);
  const [, sign, units = '0', fraction = ''] = match;
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount out of range: "${text}"`);
  return sign ? -cents : cents;
}

/** Converts a JSON number from ParaBank (e.g. 515.5) to cents, refusing sub-cent precision. */
export function centsFromApi(value: number): Cents {
  if (!Number.isFinite(value)) throw new Error(`Not a monetary amount: ${String(value)}`);
  const scaled = value * 100;
  const cents = Math.round(scaled);
  // 515.5 * 100 and 0.29 * 100 differ from an integer by ~1e-12 at most; real sub-cent values
  // (e.g. 1.005) differ by ~0.5 and must not be rounded away.
  if (Math.abs(scaled - cents) > 1e-6) {
    throw new Error(`ParaBank returned an amount with sub-cent precision: ${value}`);
  }
  return cents === 0 ? 0 : cents;
}

export function toCents(dollars: number | string): Cents {
  return typeof dollars === 'number' ? centsFromApi(dollars) : parseAmount(dollars);
}

function plainDecimal(amount: Cents): string {
  if (!Number.isSafeInteger(amount)) throw new Error(`Not an integer cent amount: ${amount}`);
  const absolute = Math.abs(amount);
  const units = Math.trunc(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${units}.${fraction}`;
}

/** Value typed into ParaBank amount fields, e.g. 1 -> "0.01", 10010 -> "100.10". */
export function toAmountInput(amount: Cents): string {
  return `${amount < 0 ? '-' : ''}${plainDecimal(amount)}`;
}

/** Matches ParaBank's own currency rendering, e.g. 51550 -> "$515.50", -1000 -> "-$10.00". */
export function formatUsd(amount: Cents): string {
  return `${amount < 0 ? '-' : ''}$${plainDecimal(amount)}`;
}
