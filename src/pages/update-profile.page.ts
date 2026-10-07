import type { Locator, Page } from '@playwright/test';
import type { ContactDetails } from '../factories/customer.factory';

/** "Update Profile" (Update Contact Info), pre-filled from the customer's stored profile. */
export class UpdateProfilePage {
  readonly confirmationHeading: Locator;
  private readonly firstName: Locator;

  constructor(private readonly page: Page) {
    this.confirmationHeading = page.getByRole('heading', { name: 'Profile Updated' });
    this.firstName = page.locator('[id="customer.firstName"]');
  }

  /** Opens the form and waits until the stored profile has been loaded into it. */
  async open(): Promise<void> {
    await this.page.goto('updateprofile.htm');
    await this.page.waitForFunction(
      () => (document.getElementById('customer.firstName') as HTMLInputElement | null)?.value,
    );
  }

  async changeContactDetails(details: ContactDetails): Promise<void> {
    const values: Record<string, string> = {
      'customer.address.street': details.address.street,
      'customer.address.city': details.address.city,
      'customer.address.state': details.address.state,
      'customer.address.zipCode': details.address.zipCode,
      'customer.phoneNumber': details.phoneNumber,
    };
    for (const [id, value] of Object.entries(values)) {
      await this.page.locator(`[id="${id}"]`).fill(value);
    }
  }

  async clearFirstName(): Promise<void> {
    await this.firstName.fill('');
  }

  async setFirstName(value: string): Promise<void> {
    await this.firstName.fill(value);
  }

  /** Empties every field the page validates as required (the phone number is not one). */
  async clearMandatoryDetails(): Promise<void> {
    for (const id of [
      'customer.firstName',
      'customer.lastName',
      'customer.address.street',
      'customer.address.city',
      'customer.address.state',
      'customer.address.zipCode',
    ]) {
      await this.page.locator(`[id="${id}"]`).fill('');
    }
  }

  async clearPhoneNumber(): Promise<void> {
    await this.page.locator('[id="customer.phoneNumber"]').fill('');
  }

  /** Saves and waits for the bank's answer. */
  async save(): Promise<void> {
    await Promise.all([
      this.page.waitForResponse((r) => r.url().includes('/services_proxy/bank/customers/update/')),
      this.submit(),
    ]);
  }

  /** Clicks "Update Profile" without expecting a server round trip (client-side validation). */
  async submit(): Promise<void> {
    await this.page.getByRole('button', { name: 'Update Profile' }).click();
  }
}
