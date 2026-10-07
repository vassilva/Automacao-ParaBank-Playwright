import type { Locator, Page } from '@playwright/test';

export interface TransactionResultRow {
  transactionId: number;
  description: string;
  debit: string;
  credit: string;
}

/** The four ways ParaBank's "Find Transactions" page can search. */
export type SearchCriterion = 'transaction ID' | 'date' | 'date range' | 'amount';

/** Input, button, client-side error and request path of each search. */
const SEARCHES: Record<
  SearchCriterion,
  { inputs: string[]; button: string; error: string; request: string }
> = {
  'transaction ID': {
    inputs: ['#transactionId'],
    button: '#findById',
    error: '#transactionIdError',
    request: '/services_proxy/bank/transactions/',
  },
  date: {
    inputs: ['#transactionDate'],
    button: '#findByDate',
    error: '#transactionDateError',
    request: '/transactions/onDate/',
  },
  'date range': {
    inputs: ['#fromDate', '#toDate'],
    button: '#findByDateRange',
    error: '#dateRangeError',
    request: '/transactions/fromDate/',
  },
  amount: {
    inputs: ['#amount'],
    button: '#findByAmount',
    error: '#amountError',
    request: '/transactions/amount/',
  },
};

/** "Find Transactions": searches one account's ledger by several criteria. */
export class FindTransactionsPage {
  readonly resultsHeading: Locator;
  readonly resultRows: Locator;

  constructor(private readonly page: Page) {
    this.resultsHeading = page.getByRole('heading', { name: 'Transaction Results' });
    this.resultRows = page.locator('#transactionBody tr');
  }

  async open(): Promise<void> {
    await this.page.goto('findtrans.htm');
  }

  errorFor(criterion: SearchCriterion): Locator {
    return this.page.locator(SEARCHES[criterion].error);
  }

  /**
   * Searches the account by one criterion (a date range uses `value` for both ends). Waits for the
   * bank only when the browser accepts the input; invalid input is refused client-side.
   */
  async search(
    criterion: SearchCriterion,
    accountId: number,
    value: string,
    expectRequest = true,
  ): Promise<void> {
    const search = SEARCHES[criterion];
    const account = this.page.locator('#accountId');
    await account.locator(`option[value="${accountId}"]`).waitFor({ state: 'attached' });
    await account.selectOption(String(accountId));
    for (const input of search.inputs) await this.page.locator(input).fill(value);
    const submit = this.page.locator(search.button);
    if (!expectRequest) {
      await submit.click();
      return;
    }
    await Promise.all([
      this.page.waitForResponse((r) => r.url().includes(search.request)),
      submit.click(),
    ]);
  }

  /** Submits a search by amount; waits for the bank only when the browser accepts the input. */
  async searchByAmount(accountId: number, amount: string, expectRequest = true): Promise<void> {
    await this.search('amount', accountId, amount, expectRequest);
  }

  async readResults(): Promise<TransactionResultRow[]> {
    await this.resultsHeading.waitFor();
    const rows: TransactionResultRow[] = [];
    for (const row of await this.resultRows.all()) {
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
