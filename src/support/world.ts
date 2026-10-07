import { setWorldConstructor, World } from '@cucumber/cucumber';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { ParaBankClient } from '../api/parabank-client';
import type { Customer } from '../api/types';
import type { ContactDetails, CustomerProfile } from '../factories/customer.factory';
import type { Payee } from '../factories/payee.factory';
import type { CareMessage } from '../pages/customer-care.page';
import { createPages, type Pages } from '../pages';
import type { Cents } from '../utils/money';
import { config } from './config';
import { captureLedger, type Ledger } from './ledger';
import { ScenarioTraffic } from './network-diagnostics';
import { protectedCount, protectedSince } from './redaction';

export interface OtherCustomer {
  profile: CustomerProfile;
  id: number;
  primaryAccountId: number;
  /** Bank client bound to that customer's own session (never the scenario's browser). */
  bank: ParaBankClient;
  dispose(): Promise<void>;
}

/** Roles an account plays in a scenario's wording. */
export type AccountRole = 'primary' | 'source' | 'destination';

export interface CustomerSession {
  profile: CustomerProfile;
  id: number;
  /** The funded account ParaBank opens at registration. */
  primaryAccountId: number;
  /** Its balance as first observed, before the scenario did anything. */
  openingBalance: Cents;
}

/**
 * Per-scenario state. Cucumber builds a fresh World for every scenario, and every scenario gets
 * its own browser context, so nothing here is shared between scenarios or workers.
 */
export class ParaBankWorld extends World {
  context!: BrowserContext;
  page!: Page;
  pages!: Pages;
  bank!: ParaBankClient;

  customer?: CustomerSession;
  secondaryAccountId?: number;
  /**
   * Balances the test itself expects after its setup, computed from the opening balance and
   * the known setup inputs (never read back from ParaBank).
   */
  expectedSetupBalances?: ReadonlyMap<number, Cents>;
  /** Persisted bank state captured immediately before the behavior under test. */
  baseline?: Ledger;
  private afterAction?: Promise<Ledger>;
  /** Paths of state-changing calls to the bank API (no query strings: they can hold secrets). */
  readonly bankSubmissions: string[] = [];
  /** Edge-proxy rejections (403/429) seen by the browser, reported when a scenario fails. */
  readonly edgeRejections: string[] = [];
  /** Present only when NET_DIAG=true. */
  traffic?: ScenarioTraffic;

  /**
   * Set by an action that waited until the page rendered the bank's final answer. Outcome steps
   * then read the page once instead of retrying: a settled page cannot change, so retrying would
   * only spend the assertion timeout when the answer is wrong (a known defect).
   */
  outcomeSettled = false;
  /** Facts produced by the action under test, read back by the outcome steps. */
  transferAmount?: Cents;
  payment?: { payee: Payee; amount: Cents };
  newAccountId?: number;
  loan?: { amount: Cents; downPayment: Cents };
  registrationAttempt?: CustomerProfile;
  takenUsername?: string;
  takenSsn?: string;
  careMessage?: CareMessage;
  expectedTransactionId?: number;
  expectedTransactionIds?: number[];
  contactUpdate?: ContactDetails;
  profileBefore?: Customer;
  /** A second, independent customer (own session), for cross-customer access scenarios. */
  otherCustomer?: OtherCustomer;
  /** HTTP status of a request the scenario expects the bank to refuse. */
  refusedRequestStatus?: number;
  /**
   * What a cross-customer read returned, compared in memory with the other customer's own view
   * of the same resource. Only this summary is kept: the response body is never stored.
   */
  foreignDisclosure?: { records: number; isOwnersData: boolean };
  /** The profile change the scenario's customer requests for the other customer. */
  requestedProfileChange?: Partial<Pick<Customer, 'firstName' | 'lastName'>>;
  /** Credential-shaped values the scenario's customer sends instead of the other's (unknown) ones. */
  decoyCredentials?: { username: string; password: string };
  /** The other customer's state captured right before a cross-customer attempt. */
  otherBaseline?: Ledger;
  otherProfileBefore?: Customer;

  /**
   * Values that must never appear in evidence: the synthetic credentials and identity numbers of
   * every customer this scenario created or used. Failure messages are redacted against them.
   */
  sensitiveValues(): string[] {
    const profiles = [
      this.customer?.profile,
      this.registrationAttempt,
      this.otherCustomer?.profile,
    ];
    return [
      ...profiles.flatMap((p) => (p ? [p.username, p.password, p.ssn] : [])),
      ...(this.takenUsername ? [this.takenUsername] : []),
      ...(this.takenSsn ? [this.takenSsn] : []),
      ...(this.decoyCredentials
        ? [this.decoyCredentials.username, this.decoyCredentials.password]
        : []),
      // Everything generated during this scenario, including values no field above holds.
      ...protectedSince(this.generatedMark),
    ];
  }

  /** Where this scenario's generated values start in the redaction registry. */
  private readonly generatedMark = protectedCount();

  async openBrowserContext(browser: Browser, scenarioName: string): Promise<void> {
    this.context = await browser.newContext({ baseURL: config.baseURL });
    if (config.networkDiagnostics) this.startTrafficAccounting(scenarioName);
    this.context.setDefaultTimeout(config.timeouts.action);
    this.context.setDefaultNavigationTimeout(config.timeouts.navigation);
    // Decorative images and fonts carry no behavior under test; not downloading them reduces
    // load on the shared, rate-limited site (URLs may carry a ";jsessionid=..." suffix).
    await this.context.route(/\.(?:png|jpe?g|gif|ico|svg|woff2?)(?:[;?].*)?$/, (route) =>
      route.abort(),
    );
    this.context.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/services_proxy/bank/')) {
        this.bankSubmissions.push(new URL(request.url()).pathname);
      }
    });
    this.context.on('response', (response) => {
      if (response.status() === 403 || response.status() === 429) {
        const mitigation = response.headers()['cf-mitigated'];
        this.edgeRejections.push(
          `HTTP ${response.status()} ${new URL(response.url()).pathname}` +
            (mitigation ? ` (cf-mitigated: ${mitigation})` : ''),
        );
      }
    });
    this.page = await this.context.newPage();
    this.pages = createPages(this.page);
    this.bank = new ParaBankClient(this.context.request, (method, response) =>
      this.traffic?.record(
        'api-client',
        method,
        response.url(),
        response.status(),
        response.headers(),
      ),
    );
  }

  private startTrafficAccounting(scenarioName: string): void {
    const traffic = new ScenarioTraffic(scenarioName);
    this.traffic = traffic;
    this.context.on('response', (response) => {
      const request = response.request();
      traffic.record(
        'browser',
        request.method(),
        response.url(),
        response.status(),
        response.headers(),
        request.resourceType() === 'document',
      );
    });
    // Images and fonts aborted by the route above never leave the browser.
    this.context.on('requestfailed', () => {
      traffic.blockedLocally += 1;
    });
  }

  /** The customer the scenario acts as: an existing one, or the one being registered. */
  get activeProfile(): CustomerProfile {
    const profile = this.customer?.profile ?? this.registrationAttempt;
    if (!profile) throw new Error('This step needs a customer or a registration attempt');
    return profile;
  }

  get session(): CustomerSession {
    if (!this.customer)
      throw new Error('This step needs a customer; add a "Given" that creates one');
    return this.customer;
  }

  accountId(role: AccountRole): number {
    if (role !== 'destination') return this.session.primaryAccountId;
    if (this.secondaryAccountId === undefined) {
      throw new Error('This step needs a second account; add "And I have two eligible accounts"');
    }
    return this.secondaryAccountId;
  }

  async captureBaseline(): Promise<void> {
    this.afterAction = undefined;
    this.baseline = await captureLedger(this.bank, this.session.id);
  }

  /**
   * The persisted state after the action under test, read once and shared by all outcome steps
   * of the scenario: a single consistent snapshot, and no repeated reads of the same state.
   */
  ledgerAfterAction(): Promise<Ledger> {
    this.afterAction ??= captureLedger(this.bank, this.session.id);
    return this.afterAction;
  }

  get baselineLedger(): Ledger {
    if (!this.baseline) throw new Error('No bank state was captured before the action');
    return this.baseline;
  }

  async currentLedger(): Promise<Ledger> {
    return captureLedger(this.bank, this.session.id);
  }
}

setWorldConstructor(ParaBankWorld);
