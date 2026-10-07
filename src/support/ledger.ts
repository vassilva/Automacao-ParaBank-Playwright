import type { ParaBankClient } from '../api/parabank-client';
import type { AccountType, Transaction } from '../api/types';
import { centsFromApi, type Cents } from '../utils/money';

/**
 * Persisted bank state, read from ParaBank's accounts and transactions endpoints.
 *
 * Oracle rule: a ledger only ever supplies the INITIAL state (captured before the action) or the
 * ACTUAL state (captured after it). Expected values are always computed by the tests from the
 * initial state plus the known inputs of the action, never from the state being verified.
 */

/** Business content of one posted transaction, amount in cents. */
export interface PostedEntry {
  id: number;
  accountId: number;
  type: Transaction['type'];
  description: string;
  amount: Cents;
}

export interface AccountState {
  type: AccountType;
  balance: Cents;
  entries: ReadonlyMap<number, PostedEntry>;
}

export type Ledger = ReadonlyMap<number, AccountState>;

/** An expected new entry: what the test knows independently (no id: ParaBank assigns it). */
export type ExpectedEntry = Omit<PostedEntry, 'id'>;

function toEntry(transaction: Transaction): PostedEntry {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    type: transaction.type,
    description: transaction.description,
    amount: centsFromApi(transaction.amount),
  };
}

export async function captureLedger(bank: ParaBankClient, customerId: number): Promise<Ledger> {
  const accounts = await bank.getAccounts(customerId);
  const states = await Promise.all(
    accounts.map(async (account): Promise<[number, AccountState]> => {
      const transactions = await bank.getTransactions(account.id);
      return [
        account.id,
        {
          type: account.type,
          balance: centsFromApi(account.balance),
          entries: new Map(transactions.map((t) => [t.id, toEntry(t)])),
        },
      ];
    }),
  );
  return new Map(states);
}

export function accountState(ledger: Ledger, accountId: number): AccountState {
  const state = ledger.get(accountId);
  if (!state) throw new Error(`Account ${accountId} is not part of the captured ledger`);
  return state;
}

/** Entries present after the action that did not exist before it, oldest first. */
export function newEntries(before: Ledger, after: Ledger, accountId: number): PostedEntry[] {
  const known = before.get(accountId)?.entries ?? new Map<number, PostedEntry>();
  return [...accountState(after, accountId).entries.values()]
    .filter((entry) => !known.has(entry.id))
    .sort((a, b) => a.id - b.id);
}

/** The part of an entry a test can know in advance: everything but the bank-assigned id. */
export function entryContent({ id: _id, ...content }: PostedEntry): ExpectedEntry {
  return content;
}

/** Accounts present in `after` that did not exist in `before`. */
export function openedSince(before: Ledger, after: Ledger): number[] {
  return [...after.keys()].filter((id) => !before.has(id));
}

/**
 * Accounts other than `involved` whose balance, type or transactions differ between the two
 * ledgers, plus any account that disappeared. Catches money moving to or from the wrong account.
 */
export function uninvolvedChanges(before: Ledger, after: Ledger, involved: number[]): number[] {
  const changed: number[] = [];
  for (const [id, state] of before) {
    if (involved.includes(id)) continue;
    const later = after.get(id);
    if (!later || JSON.stringify(snapshot(later)) !== JSON.stringify(snapshot(state))) {
      changed.push(id);
    }
  }
  return changed;
}

function snapshot(state: AccountState) {
  return {
    type: state.type,
    balance: state.balance,
    entries: [...state.entries.values()].sort((a, b) => a.id - b.id),
  };
}

/** Comparable, order-independent view of a whole ledger, for "nothing changed" assertions. */
export function ledgerFingerprint(ledger: Ledger) {
  return [...ledger.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, state]) => ({ id, ...snapshot(state) }));
}
