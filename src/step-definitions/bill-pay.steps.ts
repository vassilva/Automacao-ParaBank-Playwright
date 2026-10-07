import { Then, When } from '@cucumber/cucumber';
import { buildPayee } from '../factories/payee.factory';
import type { BillPayField } from '../pages/bill-pay.page';
import { expect } from '../support/assertions';
import { expectPostings } from '../support/ledger-assertions';
import { requireValue } from '../support/require-value';
import type { ParaBankWorld } from '../support/world';
import { formatUsd, toAmountInput, type Cents } from '../utils/money';

When(
  'I pay {money} dollars to a payee from my primary account',
  async function (this: ParaBankWorld, amount: Cents) {
    await this.captureBaseline();
    const payee = buildPayee();
    this.payment = { payee, amount };
    await this.pages.billPay.open();
    await this.pages.billPay.fill({
      payee,
      verifyAccountNumber: payee.accountNumber,
      amount: toAmountInput(amount),
      fromAccountId: this.accountId('primary'),
    });
    await this.pages.billPay.sendPayment();
  },
);

When(
  'I try to pay a payee with a mistyped account number confirmation',
  async function (this: ParaBankWorld) {
    await this.captureBaseline();
    const payee = buildPayee();
    await this.pages.billPay.open();
    await this.pages.billPay.fill({
      payee,
      verifyAccountNumber: `${payee.accountNumber}0`,
      amount: '18.30',
      fromAccountId: this.accountId('primary'),
    });
    await this.pages.billPay.submit();
  },
);

When(
  'I pay {string} dollars to a payee from my primary account',
  async function (this: ParaBankWorld, amount: string) {
    // Raw text as a customer would type it: invalid amounts are the point of these scenarios.
    await this.captureBaseline();
    const payee = buildPayee();
    await this.pages.billPay.open();
    await this.pages.billPay.fill({
      payee,
      verifyAccountNumber: payee.accountNumber,
      amount,
      fromAccountId: this.accountId('primary'),
    });
    await this.pages.billPay.sendPayment();
  },
);

When(
  'I try to pay a bill with the {billPayField} set to {string}',
  async function (this: ParaBankWorld, field: BillPayField, value: string) {
    const payee = buildPayee();
    const form = {
      payee,
      verifyAccountNumber: payee.accountNumber,
      amount: '23.70',
      fromAccountId: this.accountId('primary'),
    };
    if (field === 'amount') form.amount = value;
    if (field === 'payee account number') {
      form.payee = { ...payee, accountNumber: value };
      form.verifyAccountNumber = value;
    }
    if (field === 'payee name') form.payee = { ...payee, name: value };
    await this.pages.billPay.open();
    await this.pages.billPay.fill(form);
    await this.pages.billPay.submit();
  },
);

When(
  'I try to pay a bill to a payee whose name is only spaces',
  async function (this: ParaBankWorld) {
    const payee = { ...buildPayee(), name: '   ' };
    await this.pages.billPay.open();
    await this.pages.billPay.fill({
      payee,
      verifyAccountNumber: payee.accountNumber,
      amount: '27.90',
      fromAccountId: this.accountId('primary'),
    });
    await this.pages.billPay.submit();
  },
);

Then(
  'the {billPayField} should be rejected with {string}',
  async function (this: ParaBankWorld, field: BillPayField, message: string) {
    const fieldErrors = this.pages.billPay.fieldErrors(field);
    await expect(fieldErrors.first()).toHaveText(message);
    // Every message shown belongs to this field and says the same thing: nothing else is wrong.
    const shown = await fieldErrors.allInnerTexts();
    expect(new Set(shown.map((text) => text.trim()))).toEqual(new Set([message]));
    await expect(this.pages.feedback.errors).toHaveCount(shown.length);
  },
);

Then('the bill payment should not be completed', async function (this: ParaBankWorld) {
  await expect(this.pages.billPay.confirmationHeading).toBeHidden();
});

When('I submit a bill payment without any details', async function (this: ParaBankWorld) {
  await this.pages.billPay.open();
  await this.pages.billPay.submit();
});

Then(
  'the bill payment should be confirmed for that payee and amount',
  async function (this: ParaBankWorld) {
    const { billPay } = this.pages;
    await expect(billPay.confirmationHeading).toBeVisible();
    await expect(billPay.confirmedPayee).toHaveText(this.payment?.payee.name ?? '');
    await expect(billPay.confirmedAmount).toHaveText(formatUsd(this.payment?.amount ?? NaN));
    await expect(billPay.confirmedFromAccount).toHaveText(String(this.accountId('primary')));
  },
);

Then(
  'the payment should be recorded once as a debit to that payee',
  async function (this: ParaBankWorld) {
    const { payee, amount } = requireValue(this.payment, 'bill payment');
    const account = this.accountId('primary');
    await expectPostings(
      this,
      new Map([
        [
          account,
          [
            {
              accountId: account,
              type: 'Debit',
              description: `Bill Payment to ${payee.name}`,
              amount,
            },
          ],
        ],
      ]),
    );
  },
);

Then('no payment should have been submitted to the bank', function (this: ParaBankWorld) {
  // Validation runs before the request in the same click handler, so by the time the
  // validation message is visible any submission would already have been recorded.
  expect(this.bankSubmissions.filter((path) => path.endsWith('/billpay'))).toEqual([]);
});
