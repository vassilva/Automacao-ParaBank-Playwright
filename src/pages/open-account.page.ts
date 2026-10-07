import type { Locator, Page } from '@playwright/test';
import type { OpenableAccountType } from '../api/types';

/** "Open New Account": choose a type and an existing account that funds the minimum deposit. */
export class OpenAccountPage {
  readonly confirmationHeading: Locator;
  readonly newAccountNumber: Locator;

  constructor(private readonly page: Page) {
    this.confirmationHeading = page.getByRole('heading', { name: 'Account Opened!' });
    this.newAccountNumber = page.locator('#newAccountId');
  }

  async open(): Promise<void> {
    await this.page.goto('openaccount.htm');
  }

  /** Account types offered in the type selector, in display order. */
  async offeredTypes(): Promise<string[]> {
    return (await this.page.locator('#type option').allInnerTexts()).map((t) => t.trim());
  }

  /** The page's statement of the minimum opening deposit. */
  minimumDepositNotice(): Locator {
    return this.page.getByText(/A minimum of .* must be deposited into this account/);
  }

  async openAccount(type: OpenableAccountType, fundingAccountId: number): Promise<void> {
    // The funding list is filled asynchronously; wait for the wanted option before selecting it.
    const funding = this.page.locator('#fromAccountId');
    await funding.locator(`option[value="${fundingAccountId}"]`).waitFor({ state: 'attached' });
    await this.page.locator('#type').selectOption({ label: type });
    await funding.selectOption(String(fundingAccountId));
    await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('/services_proxy/bank/createAccount')),
      this.page.getByRole('button', { name: 'Open New Account' }).click(),
    ]);
  }
}
