import type { APIRequestContext, APIResponse } from '@playwright/test';

type FetchOptions = NonNullable<Parameters<APIRequestContext['fetch']>[1]>;

/** Receives every response the client gets; used only by opt-in network diagnostics. */
export type ResponseObserver = (method: string, response: APIResponse) => void;
import type { CustomerProfile } from '../factories/customer.factory';
import type { Payee } from '../factories/payee.factory';
import { toAmountInput, type Cents } from '../utils/money';
import type { Account, Customer, OpenableAccountType, Transaction } from './types';

const ACCOUNT_TYPE_CODES: Record<OpenableAccountType, number> = { CHECKING: 0, SAVINGS: 1 };
const JSON_HEADERS = { accept: 'application/json' };

/**
 * Explains 403/429 answers from the Cloudflare edge in front of the public ParaBank, so they
 * are triaged as environment instability rather than product or automation defects.
 * The suite never tries to get around these protections.
 */
export function edgeRejectionHint(status: number, headers: Record<string, string> = {}): string {
  if (status === 429) {
    const wait = headers['retry-after'] ? `, retry after ${headers['retry-after']}s` : '';
    return ` (rate limited by the edge proxy${wait}: environment instability, not a product defect)`;
  }
  if (status === 403 && headers['cf-mitigated'] === 'challenge') {
    return ' (Cloudflare bot challenge on an automated request: environment instability, not a product defect)';
  }
  if (status === 403) return ' (rejected by the edge proxy: environment instability)';
  return '';
}

/**
 * Page title and validation messages of an HTML answer: application wording only, never the
 * submitted form values, so it is safe to put in an error message.
 */
function describePage(html: string): string {
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? 'no title';
  const errors = [...html.matchAll(/class="error"[^>]*>([^<]+)</gi)]
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  return `"${title}"${errors.length ? `; messages: ${errors.join(' | ')}` : ''}`;
}

/**
 * Thin transport client for the endpoints the ParaBank UI itself calls.
 * It shares the browser context's cookie jar, so it acts as the same signed-in customer.
 * Error messages never include request or response bodies: they can contain customer data.
 */
export class ParaBankClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly observe?: ResponseObserver,
  ) {}

  /** Submits the public registration form; on success ParaBank also signs the session in. */
  async registerCustomer(profile: CustomerProfile): Promise<void> {
    // The registration controller needs the form-backing session created by a GET first.
    await this.expectOk(await this.send('GET', 'register.htm'), 'open the registration form');
    const response = await this.send('POST', 'register.htm', {
      form: {
        'customer.firstName': profile.firstName,
        'customer.lastName': profile.lastName,
        'customer.address.street': profile.address.street,
        'customer.address.city': profile.address.city,
        'customer.address.state': profile.address.state,
        'customer.address.zipCode': profile.address.zipCode,
        'customer.phoneNumber': profile.phoneNumber,
        'customer.ssn': profile.ssn,
        'customer.username': profile.username,
        'customer.password': profile.password,
        repeatedPassword: profile.password,
      },
    });
    await this.expectOk(response, 'register a synthetic customer');
    const page = await response.text();
    if (!page.includes('<title>ParaBank | Customer Created</title>')) {
      throw new Error(
        `ParaBank did not confirm the synthetic customer registration: ${describePage(page)}`,
      );
    }
  }

  /**
   * Id of the customer this session is signed in as. ParaBank exposes it only inside the
   * overview page's script (it builds the accounts URL from it), not through a JSON endpoint.
   */
  async signedInCustomerId(): Promise<number> {
    const response = await this.send('GET', 'overview.htm');
    await this.expectOk(response, 'open the accounts overview');
    const id = /services_proxy\/bank\/customers\/"\s*\+\s*(\d+)/.exec(await response.text())?.[1];
    if (!id) throw new Error('The accounts overview did not identify the signed-in customer');
    return Number(id);
  }

  async getAccounts(customerId: number): Promise<Account[]> {
    return this.json<Account[]>(await this.accountsResponse(customerId), 'list customer accounts');
  }

  /** Raw response, for checks about who may read the accounts (e.g. after signing out). */
  async accountsResponse(customerId: number): Promise<APIResponse> {
    return this.send('GET', `services_proxy/bank/customers/${customerId}/accounts`, {
      headers: JSON_HEADERS,
    });
  }

  async getTransactions(accountId: number): Promise<Transaction[]> {
    const response = await this.send(
      'GET',
      `services_proxy/bank/accounts/${accountId}/transactions`,
      { headers: JSON_HEADERS },
    );
    return this.json<Transaction[]>(response, 'list account transactions');
  }

  async getCustomer(customerId: number): Promise<Customer> {
    const response = await this.send('GET', `services_proxy/bank/customers/${customerId}`, {
      headers: JSON_HEADERS,
    });
    return this.json<Customer>(response, 'read the customer profile');
  }

  async openAccount(
    customerId: number,
    type: OpenableAccountType,
    fromAccountId: number,
  ): Promise<Account> {
    const response = await this.send('POST', 'services_proxy/bank/createAccount', {
      headers: JSON_HEADERS,
      params: { customerId, newAccountType: ACCOUNT_TYPE_CODES[type], fromAccountId },
    });
    return this.json<Account>(response, 'open an account');
  }

  async transfer(fromAccountId: number, toAccountId: number, amount: Cents): Promise<void> {
    const response = await this.send('POST', 'services_proxy/bank/transfer', {
      params: { fromAccountId, toAccountId, amount: toAmountInput(amount) },
    });
    await this.expectOk(response, 'transfer funds');
  }

  // Raw requests for access-control checks: the caller asserts the status, so nothing throws.

  async customerResponse(customerId: number): Promise<APIResponse> {
    return this.send('GET', `services_proxy/bank/customers/${customerId}`, {
      headers: JSON_HEADERS,
    });
  }

  async transactionsResponse(accountId: number): Promise<APIResponse> {
    return this.send('GET', `services_proxy/bank/accounts/${accountId}/transactions`, {
      headers: JSON_HEADERS,
    });
  }

  async transferResponse(from: number, to: number, amount: Cents): Promise<APIResponse> {
    return this.send('POST', 'services_proxy/bank/transfer', {
      params: { fromAccountId: from, toAccountId: to, amount: toAmountInput(amount) },
    });
  }

  async billPayResponse(accountId: number, amount: Cents, payee: Payee): Promise<APIResponse> {
    return this.send('POST', 'services_proxy/bank/billpay', {
      headers: JSON_HEADERS,
      params: { accountId, amount: toAmountInput(amount) },
      data: {
        name: payee.name,
        address: payee.address,
        phoneNumber: payee.phoneNumber,
        accountNumber: Number(payee.accountNumber),
      },
    });
  }

  async openAccountResponse(
    customerId: number,
    type: OpenableAccountType,
    fromAccountId: number,
  ): Promise<APIResponse> {
    return this.send('POST', 'services_proxy/bank/createAccount', {
      headers: JSON_HEADERS,
      params: { customerId, newAccountType: ACCOUNT_TYPE_CODES[type], fromAccountId },
    });
  }

  /**
   * The profile update exactly as ParaBank's page sends it. ParaBank requires the customer's
   * username and password in the query string (a documented product finding), so this request
   * must only ever go to the controlled environment and its traces must not be shared.
   */
  async updateProfileResponse(
    customerId: number,
    profile: CustomerProfile,
    changes: Partial<Pick<CustomerProfile, 'firstName' | 'lastName'>>,
  ): Promise<APIResponse> {
    const next = { ...profile, ...changes };
    return this.send('POST', `services_proxy/bank/customers/update/${customerId}`, {
      params: {
        firstName: next.firstName,
        lastName: next.lastName,
        street: next.address.street,
        city: next.address.city,
        state: next.address.state,
        zipCode: next.address.zipCode,
        phoneNumber: next.phoneNumber,
        ssn: next.ssn,
        username: next.username,
        password: next.password,
      },
    });
  }

  private async send(
    method: string,
    url: string,
    options: FetchOptions = {},
  ): Promise<APIResponse> {
    const response = await this.request.fetch(url, { ...options, method });
    this.observe?.(method, response);
    return response;
  }

  private async json<T>(response: APIResponse, action: string): Promise<T> {
    await this.expectOk(response, action);
    return (await response.json()) as T;
  }

  private async expectOk(response: APIResponse, action: string): Promise<void> {
    if (response.ok()) return;
    const status = response.status();
    const hint = edgeRejectionHint(status, response.headers());
    await response.dispose();
    throw new Error(`ParaBank could not ${action}: HTTP ${status}${hint}`);
  }
}
