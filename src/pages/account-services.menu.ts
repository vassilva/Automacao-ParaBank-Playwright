import type { Locator, Page } from '@playwright/test';

/** Left-hand "Account Services" menu shown only to signed-in customers. */
export class AccountServicesMenu {
  readonly welcome: Locator;
  readonly logOutLink: Locator;

  constructor(private readonly page: Page) {
    this.welcome = page.locator('#leftPanel p.smallText');
    this.logOutLink = page.getByRole('link', { name: 'Log Out' });
  }

  async signOut(): Promise<void> {
    await this.logOutLink.click();
    await this.page.waitForURL(/index\.htm/);
  }
}
