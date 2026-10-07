import { Then, When } from '@cucumber/cucumber';
import { expect } from '../support/assertions';
import { expectPostings } from '../support/ledger-assertions';
import { requireValue } from '../support/require-value';
import type { ParaBankWorld } from '../support/world';
import { formatUsd, toAmountInput, type Cents } from '../utils/money';

When(
  'I transfer {money} dollars from my source account to my destination account',
  async function (this: ParaBankWorld, amount: Cents) {
    await this.captureBaseline();
    this.transferAmount = amount;
    await this.pages.transfer.open();
    await this.pages.transfer.transfer(
      toAmountInput(amount),
      this.accountId('source'),
      this.accountId('destination'),
    );
  },
);

When(
  'I submit a transfer of {string} dollars from my source account to my destination account',
  async function (this: ParaBankWorld, amount: string) {
    // Raw text as a customer would type it: invalid amounts are the point of these scenarios.
    await this.captureBaseline();
    await this.pages.transfer.open();
    await this.pages.transfer.transfer(
      amount,
      this.accountId('source'),
      this.accountId('destination'),
    );
    this.outcomeSettled = true;
  },
);

Then(
  'the transfer should be confirmed for {money} dollars between those accounts',
  async function (this: ParaBankWorld, amount: Cents) {
    const { transfer } = this.pages;
    await expect(transfer.confirmationHeading).toBeVisible();
    await expect(transfer.confirmedAmount).toHaveText(formatUsd(amount));
    await expect(transfer.confirmedFromAccount).toHaveText(String(this.accountId('source')));
    await expect(transfer.confirmedToAccount).toHaveText(String(this.accountId('destination')));
  },
);

Then('the transfer should not be confirmed', async function (this: ParaBankWorld) {
  const { transfer } = this.pages;
  await expect(transfer.errorHeading).toBeVisible();
  await expect(transfer.confirmationHeading).toBeHidden();
});

Then(
  "the transfer should be recorded once in each account's transactions",
  async function (this: ParaBankWorld) {
    const amount = requireValue(this.transferAmount, 'transfer amount');
    const source = this.accountId('source');
    const destination = this.accountId('destination');
    await expectPostings(
      this,
      new Map([
        [
          source,
          [{ accountId: source, type: 'Debit', description: 'Funds Transfer Sent', amount }],
        ],
        [
          destination,
          [
            {
              accountId: destination,
              type: 'Credit',
              description: 'Funds Transfer Received',
              amount,
            },
          ],
        ],
      ]),
    );
  },
);
