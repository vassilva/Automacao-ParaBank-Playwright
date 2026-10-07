import { Then } from '@cucumber/cucumber';
import { expect } from '../support/assertions';
import { outcomeCheck } from '../support/outcome-check';
import { accountState, ledgerFingerprint } from '../support/ledger';
import type { AccountRole, ParaBankWorld } from '../support/world';
import { formatUsd, type Cents } from '../utils/money';

// Outcomes verified against persisted bank state. The expected balance is computed here from the
// balance captured BEFORE the action and the scenario's known input; the actual balance is read
// AFTER the action. Neither comes from the response of the action being tested.

async function expectBalance(world: ParaBankWorld, role: AccountRole, change: Cents) {
  const accountId = world.accountId(role);
  const before = accountState(world.baselineLedger, accountId).balance;
  const expectedAfter = before + change;
  const actualAfter = accountState(await world.ledgerAfterAction(), accountId).balance;
  expect(
    actualAfter,
    `${role} account ${accountId}: ${formatUsd(before)} ${change < 0 ? '-' : '+'} ` +
      `${formatUsd(Math.abs(change))} should be ${formatUsd(expectedAfter)}`,
  ).toBe(expectedAfter);
}

Then(
  'my {accountRole} account balance should decrease by {money} dollars',
  async function (this: ParaBankWorld, role: AccountRole, amount: Cents) {
    await expectBalance(this, role, -amount);
  },
);

Then(
  'my {accountRole} account balance should increase by {money} dollars',
  async function (this: ParaBankWorld, role: AccountRole, amount: Cents) {
    await expectBalance(this, role, amount);
  },
);

Then('no money should have moved in any of my accounts', async function (this: ParaBankWorld) {
  // The accounts were readable before the action (the baseline was read from them). The bank
  // answering them with an application error afterwards (HTTP 5xx) is itself a change of state.
  // A transport failure throws from the request and a 4xx is a session or environment problem:
  // neither is an outcome of the action, so neither is reported as one.
  const response = await this.bank.accountsResponse(this.session.id);
  const status = response.status();
  await response.dispose();
  if (status !== 200 && status < 500) {
    throw new Error(`The accounts could not be read to verify the outcome: HTTP ${status}`);
  }
  await outcomeCheck('ledger-readable', () =>
    expect(status, `accounts of customer ${this.session.id} readable after the action`).toBe(200),
  );
  // Every account's type, balance and full transaction list, and the set of accounts itself.
  await outcomeCheck('ledger-unchanged', async () =>
    expect(ledgerFingerprint(await this.ledgerAfterAction())).toEqual(
      ledgerFingerprint(this.baselineLedger),
    ),
  );
});
