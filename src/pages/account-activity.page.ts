import type { Locator, Page } from '@playwright/test';

export interface ActivityRow {
  transactionId: number;
  description: string;
  debit: string;
  credit: string;
}

/** "Account Details" and "Account Activity" of one account (activity.htm?id=...). */
export class AccountActivityPage {
  readonly heading: Locator;
  readonly accountNumber: Locator;
  readonly accountType: Locator;
  readonly balance: Locator;
  readonly availableBalance: Locator;
  private readonly rows: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Account Details' });
    this.accountNumber = page.locator('#accountId');
    this.accountType = page.locator('#accountType');
    this.balance = page.locator('#balance');
    this.availableBalance = page.locator('#availableBalance');
    this.rows = page.locator('#transactionTable tbody tr');
  }

  /** Waits until both the account details and its activity have been loaded. */
  async waitUntilLoaded(): Promise<void> {
    await this.heading.waitFor();
    await this.accountNumber.filter({ hasText: /\d/ }).waitFor();
    await this.page
      .locator('#transactionTable tbody tr, #noTransactions')
      .locator('visible=true')
      .first()
      .waitFor();
  }

  async readRows(): Promise<ActivityRow[]> {
    const rows: ActivityRow[] = [];
    for (const row of await this.rows.all()) {
      const link = row.getByRole('link');
      const href = (await link.getAttribute('href')) ?? '';
      const cells = await row.getByRole('cell').allInnerTexts();
      rows.push({
        transactionId: Number(new URL(href, this.page.url()).searchParams.get('id')),
        description: (await link.innerText()).trim(),
        debit: (cells[2] ?? '').trim(),
        credit: (cells[3] ?? '').trim(),
      });
    }
    return rows;
  }
}
