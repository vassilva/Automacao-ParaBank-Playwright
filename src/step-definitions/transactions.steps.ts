import { Given, Then, When } from '@cucumber/cucumber';
import type { Transaction } from '../api/types';
import type { SearchCriterion, TransactionResultRow } from '../pages/find-transactions.page';
import { expect } from '../support/assertions';
import { newEntries } from '../support/ledger';
import { requireValue } from '../support/require-value';
import type { ParaBankWorld } from '../support/world';
import { centsFromApi, formatUsd, toAmountInput, type Cents } from '../utils/money';

/**
 * The calendar day of a transaction in ParaBank's search format (MM-dd-yyyy). ParaBank stores a
 * date without time and serializes it as midnight of the server's time zone; adding 12 hours
 * before reading the UTC day keeps the right day for any server offset within +/-12 hours.
 */
function bankDay(date: number): string {
  const day = new Date(date + 12 * 60 * 60 * 1000);
  const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(day.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}-${day.getUTCFullYear()}`;
}

/** How a persisted transaction must appear in the results table (independent of the page). */
function resultRow(transaction: Transaction): TransactionResultRow {
  const amount = formatUsd(centsFromApi(transaction.amount));
  return {
    transactionId: transaction.id,
    description: transaction.description,
    debit: transaction.type === 'Debit' ? amount : '',
    credit: transaction.type === 'Credit' ? amount : '',
  };
}

/** Transfers the amount once through the bank API and returns the id of the posted debit. */
async function transferAndFindDebit(world: ParaBankWorld, amount: Cents): Promise<number> {
  const source = world.accountId('source');
  const before = await world.currentLedger();
  await world.bank.transfer(source, world.accountId('destination'), amount);
  const sent = newEntries(before, await world.currentLedger(), source);
  // The search is only meaningful if setup produced exactly the debit we will look for.
  const [debit] = sent;
  if (
    sent.length !== 1 ||
    !debit ||
    debit.type !== 'Debit' ||
    debit.amount !== amount ||
    debit.description !== 'Funds Transfer Sent'
  ) {
    throw new Error(`Setup transfer did not post exactly one ${formatUsd(amount)} debit`);
  }
  return debit.id;
}

Given(
  'I have already transferred {money} dollars from my source account to my destination account',
  async function (this: ParaBankWorld, amount: Cents) {
    // Setup through the bank API; the transfer UI is covered by its own feature.
    this.expectedTransactionId = await transferAndFindDebit(this, amount);
    this.expectedTransactionIds = [this.expectedTransactionId];
  },
);

Given(
  'I have already transferred {money} dollars from my source account to my destination account twice',
  async function (this: ParaBankWorld, amount: Cents) {
    this.expectedTransactionIds = [
      await transferAndFindDebit(this, amount),
      await transferAndFindDebit(this, amount),
    ];
  },
);

When(
  "I search my source account's transactions for {money} dollars",
  async function (this: ParaBankWorld, amount: Cents) {
    await this.pages.findTransactions.open();
    await this.pages.findTransactions.searchByAmount(
      this.accountId('source'),
      toAmountInput(amount),
    );
  },
);

When(
  "I search my source account's transactions by the {searchCriterion} of that transfer",
  async function (this: ParaBankWorld, criterion: SearchCriterion) {
    const transferId = requireValue(this.expectedTransactionId, 'setup transfer');
    const source = this.accountId('source');
    const transfer = (await this.bank.getTransactions(source)).find((t) => t.id === transferId);
    if (!transfer) throw new Error('The setup transfer is not in the source account');
    const value =
      criterion === 'transaction ID'
        ? String(transfer.id)
        : criterion === 'amount'
          ? toAmountInput(centsFromApi(transfer.amount))
          : bankDay(transfer.date);
    await this.pages.findTransactions.open();
    await this.pages.findTransactions.search(criterion, source, value);
  },
);

When(
  "I search my primary account's transactions by {searchCriterion} {string}",
  async function (this: ParaBankWorld, criterion: SearchCriterion, value: string) {
    const valid =
      criterion === 'date' || criterion === 'date range'
        ? /^\d{2}-\d{2}-\d{4}$/.test(value)
        : Number.isFinite(Number(value));
    await this.pages.findTransactions.open();
    await this.pages.findTransactions.search(criterion, this.accountId('primary'), value, valid);
  },
);

Then(
  'the results should list only that transfer as a {money} dollar debit',
  async function (this: ParaBankWorld, amount: Cents) {
    expect(await this.pages.findTransactions.readResults()).toEqual([
      {
        transactionId: this.expectedTransactionId,
        description: 'Funds Transfer Sent',
        debit: formatUsd(amount),
        credit: '',
      },
    ]);
  },
);

Then(
  'the results should list both of those transfers as {money} dollar debits',
  async function (this: ParaBankWorld, amount: Cents) {
    const ids = requireValue(this.expectedTransactionIds, 'setup transfers');
    const rows = await this.pages.findTransactions.readResults();
    expect(rows.sort((a, b) => a.transactionId - b.transactionId)).toEqual(
      [...ids]
        .sort((a, b) => a - b)
        .map((transactionId) => ({
          transactionId,
          description: 'Funds Transfer Sent',
          debit: formatUsd(amount),
          credit: '',
        })),
    );
  },
);

Then(
  "the results should list exactly my source account's transactions matching that {searchCriterion}",
  async function (this: ParaBankWorld, criterion: SearchCriterion) {
    const transferId = requireValue(this.expectedTransactionId, 'setup transfer');
    // Expected rows come from the persisted ledger, read independently of the results page.
    const persisted = await this.bank.getTransactions(this.accountId('source'));
    const transfer = persisted.find((t) => t.id === transferId);
    if (!transfer) throw new Error('The setup transfer is not in the source account');
    const matching =
      criterion === 'transaction ID'
        ? [transfer]
        : persisted.filter((t) => bankDay(t.date) === bankDay(transfer.date));
    const rows = await this.pages.findTransactions.readResults();
    expect(rows.sort((a, b) => a.transactionId - b.transactionId)).toEqual(
      matching.map(resultRow).sort((a, b) => a.transactionId - b.transactionId),
    );
  },
);

Then('the transaction results should be empty', async function (this: ParaBankWorld) {
  const { findTransactions } = this.pages;
  await expect(findTransactions.resultsHeading).toBeVisible();
  await expect(findTransactions.resultRows).toHaveCount(0);
});

Then(
  'I should be told {string} for the {searchCriterion} search',
  async function (this: ParaBankWorld, message: string, criterion: SearchCriterion) {
    await expect(this.pages.findTransactions.errorFor(criterion)).toHaveText(message);
  },
);

Then('no transaction results should be shown', async function (this: ParaBankWorld) {
  await expect(this.pages.findTransactions.resultsHeading).toBeHidden();
});
