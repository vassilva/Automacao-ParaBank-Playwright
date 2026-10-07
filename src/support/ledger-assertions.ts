import { expect } from './assertions';
import {
  entryContent,
  newEntries,
  openedSince,
  uninvolvedChanges,
  type ExpectedEntry,
} from './ledger';
import type { ParaBankWorld } from './world';

/**
 * Asserts the complete set of postings caused by the action under test:
 * - each involved account received exactly the expected new entries (content and count, so a
 *   wrong amount, wrong direction, wrong account or a duplicate all fail);
 * - no other account changed in any way;
 * - no account was opened except the ones listed in `openedAccounts`.
 * Expected entries come from the scenario's known inputs, never from the bank's response.
 */
export async function expectPostings(
  world: ParaBankWorld,
  expected: ReadonlyMap<number, ExpectedEntry[]>,
  openedAccounts: number[] = [],
): Promise<void> {
  const before = world.baselineLedger;
  const after = await world.ledgerAfterAction();
  for (const [accountId, entries] of expected) {
    expect(
      newEntries(before, after, accountId).map(entryContent),
      `new entries on account ${accountId}`,
    ).toEqual(entries);
  }
  expect(openedSince(before, after).sort(), 'accounts opened by the action').toEqual(
    [...openedAccounts].sort(),
  );
  expect(
    uninvolvedChanges(before, after, [...expected.keys()]),
    'accounts that should not have been touched',
  ).toEqual([]);
}
