import type { Locator, Page } from '@playwright/test';
import type { Payee } from '../factories/payee.factory';

/** Inputs whose client-side validation the scenarios check individually. */
export type BillPayField = 'amount' | 'payee account number' | 'payee name';

export interface BillPaymentForm {
  payee: Payee;
  verifyAccountNumber: string;
  amount: string;
  fromAccountId: number;
}

/** "Bill Payment Service": pays an external payee from one of the customer's accounts. */
export class BillPayPage {
  readonly confirmationHeading: Locator;
  readonly confirmedPayee: Locator;
  readonly confirmedAmount: Locator;
  readonly confirmedFromAccount: Locator;

  constructor(private readonly page: Page) {
    const result = page.locator('#billpayResult');
    this.confirmationHeading = result.getByRole('heading', { name: 'Bill Payment Complete' });
    this.confirmedPayee = result.locator('#payeeName');
    this.confirmedAmount = result.locator('#amount');
    this.confirmedFromAccount = result.locator('#fromAccountId');
  }

  async open(): Promise<void> {
    await this.page.goto('billpay.htm');
  }

  /**
   * Visible validation messages belonging to one input. The account number is entered twice
   * (number and confirmation), so its messages cover both inputs.
   */
  fieldErrors(field: BillPayField): Locator {
    const ids: Record<BillPayField, string> = {
      amount: '[id^="validationModel-amount-"]',
      'payee account number':
        '[id^="validationModel-account-"], [id^="validationModel-verifyAccount-"]',
      'payee name': '#validationModel-name',
    };
    return this.page.locator(ids[field]).locator('visible=true');
  }

  async fill(form: BillPaymentForm): Promise<void> {
    const values: Record<string, string> = {
      'payee.name': form.payee.name,
      'payee.address.street': form.payee.address.street,
      'payee.address.city': form.payee.address.city,
      'payee.address.state': form.payee.address.state,
      'payee.address.zipCode': form.payee.address.zipCode,
      'payee.phoneNumber': form.payee.phoneNumber,
      'payee.accountNumber': form.payee.accountNumber,
      verifyAccount: form.verifyAccountNumber,
      amount: form.amount,
    };
    for (const [name, value] of Object.entries(values)) {
      await this.page.locator(`input[name="${name}"]`).fill(value);
    }
    const from = this.page.locator('select[name="fromAccountId"]');
    await from.locator(`option[value="${form.fromAccountId}"]`).waitFor({ state: 'attached' });
    await from.selectOption(String(form.fromAccountId));
  }

  /** Sends a valid payment and waits for the bank's answer. */
  async sendPayment(): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('/services_proxy/bank/billpay')),
      this.submit(),
    ]);
  }

  /** Clicks "Send Payment" without expecting a server round trip (client-side validation). */
  async submit(): Promise<void> {
    await this.page.getByRole('button', { name: 'Send Payment' }).click();
  }
}
