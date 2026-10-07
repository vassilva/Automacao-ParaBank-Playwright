import type { Locator, Page } from '@playwright/test';
import type { Address } from '../api/types';

/** What the login recovery form asks for to identify a customer. */
export interface IdentityDetails {
  firstName: string;
  lastName: string;
  address: Address;
  ssn: string;
}

/** Public "Customer Lookup" page used to recover forgotten login information. */
export class CustomerLookupPage {
  readonly heading: Locator;
  readonly locatedMessage: Locator;
  /**
   * The recovery result prints the username AND the password as text. Read only to compare
   * values in memory, never to report them; failure screenshots mask it (see hooks.ts).
   */
  private readonly recoveredCredentials: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Customer Lookup' });
    this.locatedMessage = page.getByText(
      'Your login information was located successfully. You are now logged in.',
    );
    this.recoveredCredentials = page.locator('#rightPanel p').filter({ hasText: /Password/ });
  }

  async open(): Promise<void> {
    await this.page.goto('lookup.htm');
  }

  async submitEmpty(): Promise<void> {
    await this.page.getByRole('button', { name: 'Find My Login Info' }).click();
  }

  /** Inputs have no accessible labels; their ids mirror ParaBank's form model and are stable. */
  async requestLoginInfo(identity: IdentityDetails): Promise<void> {
    const values: Record<string, string> = {
      firstName: identity.firstName,
      lastName: identity.lastName,
      'address.street': identity.address.street,
      'address.city': identity.address.city,
      'address.state': identity.address.state,
      'address.zipCode': identity.address.zipCode,
      ssn: identity.ssn,
    };
    for (const [id, value] of Object.entries(values)) {
      await this.page.locator(`[id="${id}"]`).fill(value);
    }
    await Promise.all([
      // The answer is served at the same URL, so waiting for the URL would return at once:
      // wait for the next document load instead (the current one has already loaded).
      this.page.waitForEvent('load'),
      this.page.getByRole('button', { name: 'Find My Login Info' }).click(),
    ]);
  }

  /** The username shown in the recovery result (kept in memory, never reported). */
  async recoveredUsername(): Promise<string | undefined> {
    const text = await this.recoveredCredentials.innerText();
    return /Username\s*:\s*(\S+)/.exec(text)?.[1];
  }
}
