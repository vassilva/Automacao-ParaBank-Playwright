import type { Locator, Page } from '@playwright/test';
import type { Account } from '../api/types';

export interface OverviewRow {
  accountId: string;
  balance: string;
  available: string;
}

export interface OverviewLoad {
  customerId: number;
  accounts: Account[];
}

const ACCOUNTS_ENDPOINT = /services_proxy\/bank\/customers\/(\d+)\/accounts$/;

/** "Accounts Overview": a table rendered client-side from the customer's accounts endpoint. */
export class AccountsOverviewPage {
  readonly heading: Locator;
  readonly accountRows: Locator;
  readonly totalRow: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Accounts Overview' });
    const rows = page.locator('#accountTable tbody tr');
    this.accountRows = rows.filter({ has: page.getByRole('link') });
    this.totalRow = rows.filter({ hasText: 'Total' });
  }

  /**
   * Opens the overview and returns the data the page was rendered from. The customer id is only
   * exposed through this request, so it is how a scenario learns which customer it is driving.
   */
  async open(): Promise<OverviewLoad> {
    const [response] = await Promise.all([
      this.page.waitForResponse((r) => ACCOUNTS_ENDPOINT.test(new URL(r.url()).pathname)),
      this.page.goto('overview.htm'),
    ]);
    if (!response.ok()) {
      throw new Error(`Accounts overview data failed to load: HTTP ${response.status()}`);
    }
    const customerId = Number(ACCOUNTS_ENDPOINT.exec(new URL(response.url()).pathname)?.[1]);
    const accounts = (await response.json()) as Account[];
    await this.totalRow.waitFor();
    return { customerId, accounts };
  }

  /** Follows the account number link to that account's details page. */
  async openAccountDetails(accountId: number): Promise<void> {
    await this.accountRows.getByRole('link', { name: String(accountId), exact: true }).click();
    await this.page.waitForURL(/activity\.htm\?id=\d+/);
  }

  /** Text of the "Total" balance cell. */
  async readTotal(): Promise<string> {
    return (await this.totalRow.getByRole('cell').nth(1).innerText()).trim();
  }

  async readRows(): Promise<OverviewRow[]> {
    const rows: OverviewRow[] = [];
    for (const row of await this.accountRows.all()) {
      const cells = await row.getByRole('cell').allInnerTexts();
      rows.push({
        accountId: (cells[0] ?? '').trim(),
        balance: (cells[1] ?? '').trim(),
        available: (cells[2] ?? '').trim(),
      });
    }
    return rows;
  }
}
