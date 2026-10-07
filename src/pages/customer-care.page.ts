import type { Locator, Page } from '@playwright/test';

export interface CareMessage {
  name: string;
  email: string;
  phone: string;
  message: string;
}

/** Public "Customer Care" contact form. */
export class CustomerCarePage {
  readonly heading: Locator;
  readonly representativeNotice: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Customer Care' });
    this.representativeNotice = page.getByText(
      'A Customer Care Representative will be contacting you.',
    );
  }

  thanks(name: string): Locator {
    return this.page.getByText(`Thank you ${name}`, { exact: true });
  }

  async open(): Promise<void> {
    await this.page.goto('contact.htm');
  }

  /** Inputs have no accessible labels; their ids mirror ParaBank's form model and are stable. */
  async send(message?: CareMessage): Promise<void> {
    if (message) {
      const values: [string, string][] = [
        ['name', message.name],
        ['email', message.email],
        ['phone', message.phone],
        ['message', message.message],
      ];
      for (const [id, value] of values) {
        await this.page.locator(`[id="${id}"]`).fill(value);
      }
    }
    await Promise.all([
      this.page.waitForURL(/contact\.htm/, { waitUntil: 'load' }),
      this.page.getByRole('button', { name: 'Send to Customer Care' }).click(),
    ]);
  }
}
