import { Then, When } from '@cucumber/cucumber';
import type { Locator } from '@playwright/test';
import { expect } from '../support/assertions';
import { outcomeCheck } from '../support/outcome-check';
import { accountState, openedSince } from '../support/ledger';
import { expectPostings } from '../support/ledger-assertions';
import { requireValue } from '../support/require-value';
import type { ParaBankWorld } from '../support/world';
import { formatUsd, toAmountInput, type Cents } from '../utils/money';

When(
  'I request a loan of {money} dollars with a {money} dollar down payment from my primary account',
  async function (this: ParaBankWorld, amount: Cents, downPayment: Cents) {
    await this.captureBaseline();
    this.loan = { amount, downPayment };
    await this.pages.requestLoan.open();
    await this.pages.requestLoan.apply(
      toAmountInput(amount),
      toAmountInput(downPayment),
      this.accountId('primary'),
    );
  },
);

/**
 * What ParaBank's loan provider counts as the customer's available funds: the sum of every
 * non-loan balance, read BEFORE the request (integer cents).
 */
function availableFunds(world: ParaBankWorld): Cents {
  return [...world.baselineLedger.values()]
    .filter((account) => account.type !== 'LOAN')
    .reduce((sum, account) => sum + account.balance, 0);
}

async function requestLoan(world: ParaBankWorld, amount: Cents, downPayment: Cents) {
  world.loan = { amount, downPayment };
  await world.pages.requestLoan.open();
  await world.pages.requestLoan.apply(
    toAmountInput(amount),
    toAmountInput(downPayment),
    world.accountId('primary'),
  );
  world.outcomeSettled = true;
}

When(
  'I request a loan of five times my available funds with a {money} dollar down payment from my primary account',
  async function (this: ParaBankWorld, downPayment: Cents) {
    await this.captureBaseline();
    // The funds are exactly 20% of the amount: the provider's threshold.
    await requestLoan(this, availableFunds(this) * 5, downPayment);
  },
);

When(
  'I request a loan of one cent more than five times my available funds with a {money} dollar down payment from my primary account',
  async function (this: ParaBankWorld, downPayment: Cents) {
    await this.captureBaseline();
    // The funds are just below 20% of the amount.
    await requestLoan(this, availableFunds(this) * 5 + 1, downPayment);
  },
);

When(
  'I request a loan of {money} dollars with a down payment equal to my available funds from my primary account',
  async function (this: ParaBankWorld, amount: Cents) {
    await this.captureBaseline();
    await requestLoan(this, amount, availableFunds(this));
  },
);

When(
  'I request a loan of {money} dollars with a down payment one cent above my available funds from my primary account',
  async function (this: ParaBankWorld, amount: Cents) {
    await this.captureBaseline();
    await requestLoan(this, amount, availableFunds(this) + 1);
  },
);

When(
  'I request a loan of {string} dollars with a {string} dollar down payment from my primary account',
  async function (this: ParaBankWorld, amount: string, downPayment: string) {
    // Raw text as a customer would type it: invalid values are the point of these scenarios.
    await this.captureBaseline();
    await this.pages.requestLoan.open();
    await this.pages.requestLoan.apply(amount, downPayment, this.accountId('primary'));
    this.outcomeSettled = true;
  },
);

Then('the loan should be approved', async function (this: ParaBankWorld) {
  const { requestLoan } = this.pages;
  await expect(requestLoan.resultHeading).toBeVisible();
  await expect(requestLoan.status).toHaveText('Approved');
  await expect(requestLoan.approvalMessage).toContainText(
    'Congratulations, your loan has been approved.',
  );
  await expect(requestLoan.newAccountNumber).toHaveText(/^\d+$/);
  // Used only to identify the account; its content is verified against persisted state.
  this.newAccountId = Number(await requestLoan.newAccountNumber.innerText());
});

Then(
  'a new loan account should be opened holding {money} dollars',
  async function (this: ParaBankWorld, amount: Cents) {
    const after = await this.ledgerAfterAction();
    const loanAccount = requireValue(this.newAccountId, 'loan account number');
    expect(openedSince(this.baselineLedger, after), 'accounts opened by the loan').toEqual([
      loanAccount,
    ]);
    const loan = accountState(after, loanAccount);
    expect({ type: loan.type, balance: loan.balance }).toEqual({ type: 'LOAN', balance: amount });
  },
);

Then(
  'a new loan account should be opened holding the requested amount',
  async function (this: ParaBankWorld) {
    const { amount } = requireValue(this.loan, 'loan request');
    const after = await this.ledgerAfterAction();
    const loanAccount = requireValue(this.newAccountId, 'loan account number');
    expect(openedSince(this.baselineLedger, after), 'accounts opened by the loan').toEqual([
      loanAccount,
    ]);
    const loan = accountState(after, loanAccount);
    expect({ type: loan.type, balance: loan.balance }).toEqual({ type: 'LOAN', balance: amount });
  },
);

Then('the loan should not be approved', async function (this: ParaBankWorld) {
  const { requestLoan } = this.pages;
  await expect(requestLoan.approvalMessage).toBeHidden();
  await expect(requestLoan.status).not.toHaveText('Approved');
});

Then(
  'the loan should be denied with the reason {string}',
  async function (this: ParaBankWorld, reason: string) {
    const { requestLoan } = this.pages;
    await outcomeCheck('loan-denied', async () => {
      if (this.outcomeSettled) {
        // One snapshot of the rendered decision, compared as a whole.
        const shown = async (locator: Locator) =>
          (await locator.isVisible()) ? (await locator.textContent())?.trim() : undefined;
        expect({
          resultShown: await requestLoan.resultHeading.isVisible(),
          status: await shown(requestLoan.status),
          reason: await shown(requestLoan.denialMessage),
          approvalShown: await requestLoan.approvalMessage.isVisible(),
        }).toEqual({ resultShown: true, status: 'Denied', reason, approvalShown: false });
        return;
      }
      await expect(requestLoan.resultHeading).toBeVisible();
      await expect(requestLoan.status).toHaveText('Denied');
      await expect(requestLoan.denialMessage).toHaveText(reason);
      await expect(requestLoan.approvalMessage).toBeHidden();
    });
  },
);

Then(
  'the down payment should be recorded once against my primary account',
  async function (this: ParaBankWorld) {
    const { downPayment } = requireValue(this.loan, 'loan request');
    const primary = this.accountId('primary');
    const loanAccount = requireValue(this.newAccountId, 'loan account number');
    // OBSERVED BEHAVIOR: the down payment is posted as one debit referencing the loan account,
    // and the new loan account itself has no transaction (its balance is not asserted here).
    await expectPostings(
      this,
      new Map([
        [
          primary,
          [
            {
              accountId: primary,
              type: 'Debit',
              description: `Down Payment for Loan # ${loanAccount}`,
              amount: downPayment,
            },
          ],
        ],
      ]),
      [loanAccount],
    );
    // And the posting is applied: BEFORE balance - down payment (known input) = EXPECTED AFTER.
    const before = accountState(this.baselineLedger, primary).balance;
    const expectedAfter = before - downPayment;
    const actualAfter = accountState(await this.ledgerAfterAction(), primary).balance;
    expect(
      actualAfter,
      `primary account ${primary}: ${formatUsd(before)} - ${formatUsd(downPayment)} down payment ` +
        `should leave ${formatUsd(expectedAfter)}`,
    ).toBe(expectedAfter);
  },
);
