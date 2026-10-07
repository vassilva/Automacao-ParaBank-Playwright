import type { Locator, Page } from '@playwright/test';

/** "Transfer Funds" between two of the signed-in customer's accounts. */
export class TransferFundsPage {
  readonly confirmationHeading: Locator;
  readonly confirmedAmount: Locator;
  readonly confirmedFromAccount: Locator;
  readonly confirmedToAccount: Locator;
  readonly errorHeading: Locator;

  constructor(private readonly page: Page) {
    this.confirmationHeading = page.getByRole('heading', { name: 'Transfer Complete!' });
    this.confirmedAmount = page.locator('#amountResult');
    this.confirmedFromAccount = page.locator('#fromAccountIdResult');
    this.confirmedToAccount = page.locator('#toAccountIdResult');
    this.errorHeading = page.locator('#showError').getByRole('heading', { name: 'Error!' });
  }

  async open(): Promise<void> {
    await this.page.goto('transfer.htm');
  }

  /** Submits the form and waits for the bank's answer, whatever it is. */
  async transfer(amount: string, fromAccountId: number, toAccountId: number): Promise<void> {
    const to = this.page.locator('#toAccountId');
    await to.locator(`option[value="${toAccountId}"]`).waitFor({ state: 'attached' });
    await this.page.locator('#amount').fill(amount);
    await this.page.locator('#fromAccountId').selectOption(String(fromAccountId));
    await to.selectOption(String(toAccountId));
    await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('/services_proxy/bank/transfer')),
      this.page.getByRole('button', { name: 'Transfer' }).click(),
    ]);
    // One script callback renders the answer after the response arrives: once either panel
    // shows, the page is final.
    await this.confirmationHeading.or(this.errorHeading).waitFor();
  }
}
