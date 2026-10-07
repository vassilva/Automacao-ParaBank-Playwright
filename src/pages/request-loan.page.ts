import type { Locator, Page } from '@playwright/test';

/** "Apply for a Loan": the bank decides synchronously and may open a LOAN account. */
export class RequestLoanPage {
  readonly resultHeading: Locator;
  readonly status: Locator;
  readonly approvalMessage: Locator;
  readonly denialMessage: Locator;
  readonly newAccountNumber: Locator;
  private readonly errorHeading: Locator;

  constructor(private readonly page: Page) {
    this.resultHeading = page.getByRole('heading', { name: 'Loan Request Processed' });
    this.status = page.locator('#loanStatus');
    this.approvalMessage = page.locator('#loanRequestApproved');
    this.denialMessage = page.locator('#loanRequestDenied .error');
    this.newAccountNumber = page.locator('#newAccountId');
    this.errorHeading = page.locator('#requestLoanError').getByRole('heading', { name: 'Error!' });
  }

  async open(): Promise<void> {
    await this.page.goto('requestloan.htm');
  }

  async apply(amount: string, downPayment: string, fromAccountId: number): Promise<void> {
    const from = this.page.locator('#fromAccountId');
    await from.locator(`option[value="${fromAccountId}"]`).waitFor({ state: 'attached' });
    await this.page.locator('#amount').fill(amount);
    await this.page.locator('#downPayment').fill(downPayment);
    await from.selectOption(String(fromAccountId));
    await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('/services_proxy/bank/requestLoan')),
      this.page.getByRole('button', { name: 'Apply Now' }).click(),
    ]);
    // One script callback renders the decision (status, reason) or the error panel after the
    // response arrives: once either panel shows, the page is final.
    await this.resultHeading.or(this.errorHeading).waitFor();
  }
}
