/**
 * Runtime contracts for the ParaBank JSON responses this suite reads (shapes in ./types.ts).
 *
 * The client used to trust `response.json()` with a type cast: a renamed, missing or null field
 * then surfaced later as a confusing business-assertion failure (NaN cents, `undefined` account).
 * Each read response is now checked where it is parsed, and a violation says which field broke.
 * Only the fields the suite relies on are required; extra fields are allowed (ParaBank may add
 * some). Messages name the path and the JSON type only, never a value: responses carry customer
 * data (names, SSNs).
 */
import type { Account, AccountType, Address, Customer, Transaction } from './types';

export class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractViolation';
  }
}

function kind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function fail(path: string, expected: string, value: unknown): never {
  throw new ContractViolation(
    `ParaBank response contract: ${path} must be ${expected}, got ${kind(value)}`,
  );
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'an object', value);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'an array', value);
  return value;
}

function id(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    fail(path, 'a positive integer', value);
  }
  return value;
}

function amount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a finite number', value);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'a string', value);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(path, `one of ${allowed.join(', ')}`, value);
  }
  return value as T;
}

const ACCOUNT_TYPES: readonly AccountType[] = ['CHECKING', 'SAVINGS', 'LOAN'];

export function parseAccount(value: unknown, path = 'account'): Account {
  const r = record(value, path);
  return {
    ...r,
    id: id(r.id, `${path}.id`),
    customerId: id(r.customerId, `${path}.customerId`),
    type: oneOf(r.type, ACCOUNT_TYPES, `${path}.type`),
    balance: amount(r.balance, `${path}.balance`),
  };
}

export function parseAccounts(value: unknown): Account[] {
  return list(value, 'accounts').map((item, i) => parseAccount(item, `accounts[${i}]`));
}

export function parseTransaction(value: unknown, path = 'transaction'): Transaction {
  const r = record(value, path);
  return {
    ...r,
    id: id(r.id, `${path}.id`),
    accountId: id(r.accountId, `${path}.accountId`),
    type: oneOf(r.type, ['Debit', 'Credit'] as const, `${path}.type`),
    date: amount(r.date, `${path}.date`),
    amount: amount(r.amount, `${path}.amount`),
    description: text(r.description, `${path}.description`),
  };
}

export function parseTransactions(value: unknown): Transaction[] {
  return list(value, 'transactions').map((item, i) => parseTransaction(item, `transactions[${i}]`));
}

function parseAddress(value: unknown, path: string): Address {
  const r = record(value, path);
  return {
    ...r,
    street: text(r.street, `${path}.street`),
    city: text(r.city, `${path}.city`),
    state: text(r.state, `${path}.state`),
    zipCode: text(r.zipCode, `${path}.zipCode`),
  };
}

export function parseCustomer(value: unknown): Customer {
  const r = record(value, 'customer');
  return {
    ...r,
    id: id(r.id, 'customer.id'),
    firstName: text(r.firstName, 'customer.firstName'),
    lastName: text(r.lastName, 'customer.lastName'),
    address: parseAddress(r.address, 'customer.address'),
    // Optional in the profile form: ParaBank stores an empty string when it is left blank.
    phoneNumber: text(r.phoneNumber, 'customer.phoneNumber'),
    ssn: text(r.ssn, 'customer.ssn'),
  };
}
