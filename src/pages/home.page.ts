import type { Locator, Page } from '@playwright/test';

/** Public landing page with the Customer Login panel. */
export class HomePage {
  readonly loginHeading: Locator;
  readonly registerLink: Locator;
  readonly forgotLoginLink: Locator;
  private readonly username: Locator;
  private readonly password: Locator;
  private readonly logInButton: Locator;

  constructor(private readonly page: Page) {
    this.loginHeading = page.getByRole('heading', { name: 'Customer Login' });
    this.registerLink = page.getByRole('link', { name: 'Register' });
    this.forgotLoginLink = page.getByRole('link', { name: 'Forgot login info?' });
    // The login inputs have no accessible label; their form `name` is the stable contract.
    this.username = page.locator('input[name="username"]');
    this.password = page.locator('input[name="password"]');
    this.logInButton = page.getByRole('button', { name: 'Log In' });
  }

  async open(): Promise<void> {
    await this.page.goto('index.htm');
  }

  async signIn(username: string, password: string): Promise<void> {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.logInButton.click();
  }

  async submitEmptySignIn(): Promise<void> {
    await this.logInButton.click();
  }
}
