import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../support/config';

/**
 * The single allocator for scenario-owned synthetic data. Every generated value is a deterministic
 * function of:
 *   - the RUN: this process's start time, so values differ from every earlier run;
 *   - a SERIAL: a sequence number per generated record, so values differ within the run.
 * Values are therefore unique, reproducible from (run, serial) and traceable, without uncontrolled
 * randomness. Passwords are the deliberate exception (customer.factory.ts): credentials must be
 * unpredictable. Lengths respect ParaBank's schema (names 30, address 45, city/state/zip/phone 20,
 * SSN 15, username/password 20): longer input fails registration (see PB-17).
 */
const RUN_STARTED = Date.now();
/** Base 36 of the start time in ms: 8 characters until the year 2059. */
const RUN_TOKEN = RUN_STARTED.toString(36);
let serial = 0;

const letters = (value: number, length: number): string => {
  let out = '';
  let rest = value;
  for (let i = 0; i < length; i += 1) {
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
};

/** One generated record (a customer, a payee, a contact change): its serial and letter tag. */
export interface DataSlot {
  serial: number;
  /** Letters only (names may not contain digits): 4 from the run, 3 from the serial. */
  tag: string;
}

export function nextSlot(): DataSlot {
  serial += 1;
  const raw = letters(RUN_STARTED, 4) + letters(serial, 3);
  return { serial, tag: raw.charAt(0).toUpperCase() + raw.slice(1) };
}

/** Valid US state codes, rotated per record: a closed set of 50 cannot be unique per scenario. */
const STATES =
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(
    ' ',
  );
export const stateFor = (slot: DataSlot, offset = 0): string =>
  STATES[(slot.serial + offset) % STATES.length] ?? 'CA';

/** ZIP 00000 (never issued) plus a ZIP+4 extension unique within the run. */
export const zipFor = (slot: DataSlot, base = '00000'): string =>
  `${base}-${String(slot.serial % 10_000).padStart(4, '0')}`;

/** The reserved fictional range 555-0100..0199, with an extension unique within the run. */
export const phoneFor = (slot: DataSlot): string =>
  `555-01${String(slot.serial % 100).padStart(2, '0')} x${slot.serial}`;

/** "qa" + run + serial: unique across runs and within one; 13 characters (limit 20). */
export function usernameFor(slot: DataSlot): string {
  return `qa${RUN_TOKEN}${slot.serial.toString(36).padStart(3, '0')}`;
}

/** A unique username of an exact length (field-length boundaries), padded deterministically. */
export function usernameOfLength(slot: DataSlot, length: number): string {
  const base = usernameFor(slot);
  if (length < base.length) throw new Error(`Cannot build a unique ${length}-character username`);
  return base.padEnd(length, 'x');
}

/** Digits only, at most 8 (a Java int with room for the "mistyped" variant): run + serial. */
export const payeeAccountNumberFor = (slot: DataSlot): string =>
  `1${String(RUN_STARTED % 1000).padStart(3, '0')}${String(slot.serial % 10_000).padStart(4, '0')}`;

/**
 * Synthetic SSNs in the never-issued 000 area (000-XX-XXXX, 10^6 values), allocated from a cursor
 * kept per environment in .test-data/ (git-ignored; a counter, not an SSN). Successive runs
 * against the same long-lived QA or UAT database therefore continue the sequence instead of
 * drawing again, so a suite customer's SSN is not reused until 10^6 customers later (ParaBank's
 * login recovery breaks for every customer sharing an SSN, PB-15). Without a cursor file (first
 * run, or a fresh CI workspace with a freshly deployed database) the sequence starts at random.
 */
const SSN_SPACE = 1_000_000;
const CURSOR_DIR = '.test-data';

export function nextSsn(): string {
  const file = path.join(CURSOR_DIR, `ssn-cursor-${config.targetEnv}.json`);
  let index: number;
  try {
    index = (JSON.parse(readFileSync(file, 'utf8')) as { next: number }).next;
  } catch {
    index = randomInt(0, SSN_SPACE);
  }
  if (!Number.isInteger(index) || index < 0 || index >= SSN_SPACE) index = randomInt(0, SSN_SPACE);
  mkdirSync(CURSOR_DIR, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ next: (index + 1) % SSN_SPACE })}\n`);
  const value = String(index).padStart(6, '0');
  return `000-${value.slice(0, 2)}-${value.slice(2)}`;
}
