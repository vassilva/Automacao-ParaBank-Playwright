import type { Locator, Page } from '@playwright/test';
import type { CustomerProfile } from '../factories/customer.factory';

/** Public "Signing up is easy!" registration form. */
export class RegistrationPage {
  readonly heading: Locator;
  readonly phoneRow: Locator;
  readonly successMessage: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Signing up is easy!' });
    this.phoneRow = page.getByRole('row', { name: /Phone #:/ });
    this.successMessage = page.getByText(
      'Your account was created successfully. You are now logged in.',
    );
  }

  welcomeHeading(username: string): Locator {
    return this.page.getByRole('heading', { name: `Welcome ${username}` });
  }

  async open(): Promise<void> {
    await this.page.goto('register.htm');
  }

  /** Inputs have no accessible labels; their ids mirror ParaBank's form model and are stable. */
  async register(profile: CustomerProfile, passwordConfirmation = profile.password): Promise<void> {
    const values: Record<string, string> = {
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
      repeatedPassword: passwordConfirmation,
    };
    for (const [id, value] of Object.entries(values)) {
      await this.page.locator(`[id="${id}"]`).fill(value);
    }
    await this.submit();
  }

  /** Posts the form and waits until the bank's answer page has loaded. */
  async submit(): Promise<void> {
    await Promise.all([
      // The answer is served at the same URL, so waiting for the URL would return at once:
      // wait for the next document load instead (the current one has already loaded).
      this.page.waitForEvent('load'),
      this.page.getByRole('button', { name: 'Register' }).click(),
    ]);
  }
}
