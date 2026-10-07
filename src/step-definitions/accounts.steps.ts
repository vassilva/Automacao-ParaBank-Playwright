import { Then, When, type DataTable } from '@cucumber/cucumber';
import type { OpenableAccountType } from '../api/types';
import { expect } from '../support/assertions';
import { OPENING_DEPOSIT } from '../support/bank-rules';
import { accountState, openedSince } from '../support/ledger';
import { expectPostings } from '../support/ledger-assertions';
import { requireValue } from '../support/require-value';
import type { AccountRole, ParaBankWorld } from '../support/world';
import { centsFromApi, formatUsd, type Cents } from '../utils/money';

/** What the overview must show, computed from the test's own model, not read from ParaBank. */
function expectedOverview(balances: ReadonlyMap<number, Cents>) {
  return [...balances]
    .sort(([a], [b]) => a - b)
    .map(([accountId, balance]) => ({
      accountId: String(accountId),
      balance: formatUsd(balance),
      available: formatUsd(Math.max(balance, 0)),
    }));
}

When('I view my accounts overview', async function (this: ParaBankWorld) {
  await this.pages.overview.open();
});

Then(
  'I should see each of my accounts with its current balance',
  async function (this: ParaBankWorld) {
    const model = requireValue(this.expectedSetupBalances, 'expected balances after setup');
    const rendered = [...(await this.pages.overview.readRows())].sort(
      (a, b) => Number(a.accountId) - Number(b.accountId),
    );
    // UI against the independent model ...
    expect(rendered).toEqual(expectedOverview(model));
    // ... and persisted state against the same model, read separately from the page's data.
    const persisted = await this.bank.getAccounts(this.session.id);
    expect(
      new Map(persisted.map((account) => [account.id, centsFromApi(account.balance)])),
    ).toEqual(new Map(model));
  },
);

Then(
  'the overview total should equal the sum of my balances',
  async function (this: ParaBankWorld) {
    const model = requireValue(this.expectedSetupBalances, 'expected balances after setup');
    const total = [...model.values()].reduce((sum, balance) => sum + balance, 0);
    // Opening a funded account only moves money between the customer's accounts.
    expect(total, 'model total equals the opening balance').toBe(this.session.openingBalance);
    expect(await this.pages.overview.readTotal()).toBe(formatUsd(total));
  },
);

When(
  'I open my {accountRole} account from my accounts overview',
  async function (this: ParaBankWorld, role: AccountRole) {
    await this.pages.overview.open();
    await this.pages.overview.openAccountDetails(this.accountId(role));
    await this.pages.accountActivity.waitUntilLoaded();
  },
);

Then(
  "I should see that account's number, type, balance and available amount",
  async function (this: ParaBankWorld) {
    const accountId = this.accountId('destination');
    // Expected values come from the test's own model of the setup, not from the page's data.
    const model = requireValue(this.expectedSetupBalances, 'expected balances after setup');
    const balance = requireValue(model.get(accountId), 'expected destination balance');
    const { accountActivity } = this.pages;
    await expect(accountActivity.accountNumber).toHaveText(String(accountId));
    await expect(accountActivity.accountType).toHaveText('CHECKING');
    await expect(accountActivity.balance).toHaveText(formatUsd(balance));
    await expect(accountActivity.availableBalance).toHaveText(formatUsd(Math.max(balance, 0)));
  },
);

Then(
  "I should see that account's transactions as the bank records them",
  async function (this: ParaBankWorld) {
    const accountId = this.accountId('destination');
    const persisted = await this.bank.getTransactions(accountId);
    // The opening deposit is the only movement on the new account: one credit of the deposit.
    expect(
      persisted.map((t) => ({
        type: t.type,
        description: t.description,
        amount: centsFromApi(t.amount),
      })),
      'persisted transactions of the new account',
    ).toEqual([
      { type: 'Credit', description: 'Funds Transfer Received', amount: OPENING_DEPOSIT },
    ]);
    expect(await this.pages.accountActivity.readRows()).toEqual(
      persisted.map((t) => ({
        transactionId: t.id,
        description: t.description,
        debit: t.type === 'Debit' ? formatUsd(centsFromApi(t.amount)) : '',
        credit: t.type === 'Credit' ? formatUsd(centsFromApi(t.amount)) : '',
      })),
    );
  },
);

When('I start opening a new account', async function (this: ParaBankWorld) {
  await this.pages.openAccount.open();
});

Then(
  'I should be offered exactly these account types:',
  async function (this: ParaBankWorld, types: DataTable) {
    expect(await this.pages.openAccount.offeredTypes()).toEqual(types.raw().map(([type]) => type));
  },
);

Then(
  'I should be told that {money} dollars must be deposited when the account is opened',
  async function (this: ParaBankWorld, deposit: Cents) {
    await expect(this.pages.openAccount.minimumDepositNotice()).toContainText(
      `A minimum of ${formatUsd(deposit)} must be deposited into this account at time of opening.`,
    );
  },
);

When(
  'I open a new {accountType} account funded from my primary account',
  async function (this: ParaBankWorld, type: OpenableAccountType) {
    await this.captureBaseline();
    await this.pages.openAccount.open();
    await this.pages.openAccount.openAccount(type, this.accountId('primary'));
  },
);

Then(
  'the new account should be confirmed with its account number',
  async function (this: ParaBankWorld) {
    const { openAccount } = this.pages;
    await expect(openAccount.confirmationHeading).toBeVisible();
    await expect(openAccount.newAccountNumber).toHaveText(/^\d+$/);
    // Used only to identify the account; its content is verified against persisted state.
    this.newAccountId = Number(await openAccount.newAccountNumber.innerText());
  },
);

Then(
  'the new account should be a {accountType} account holding the {money} dollar opening deposit',
  async function (this: ParaBankWorld, type: OpenableAccountType, deposit: Cents) {
    const after = await this.ledgerAfterAction();
    const opened = requireValue(this.newAccountId, 'new account number');
    expect(openedSince(this.baselineLedger, after), 'accounts opened by this action').toEqual([
      opened,
    ]);
    const state = accountState(after, opened);
    expect({ type: state.type, balance: state.balance }).toEqual({ type, balance: deposit });
  },
);

Then(
  'the opening deposit should be recorded as a transfer from my primary account to the new account',
  async function (this: ParaBankWorld) {
    const primary = this.accountId('primary');
    const opened = requireValue(this.newAccountId, 'new account number');
    const amount = OPENING_DEPOSIT;
    await expectPostings(
      this,
      new Map([
        [
          primary,
          [{ accountId: primary, type: 'Debit', description: 'Funds Transfer Sent', amount }],
        ],
        [
          opened,
          [{ accountId: opened, type: 'Credit', description: 'Funds Transfer Received', amount }],
        ],
      ]),
      [opened],
    );
  },
);
