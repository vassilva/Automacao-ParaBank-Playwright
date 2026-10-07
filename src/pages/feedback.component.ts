import type { Locator, Page } from '@playwright/test';

/**
 * Error feedback shown in ParaBank's main content panel. Every form (sign-in, registration,
 * login recovery, bill pay, profile) renders its validation and rejection messages as `.error`
 * elements there; hidden placeholders are excluded.
 */
export class Feedback {
  readonly errors: Locator;

  constructor(page: Page) {
    this.errors = page.locator('#rightPanel .error:visible');
  }

  /**
   * The messages shown right now, whitespace-normalized as toHaveText compares them. A single
   * read: use it only once the page has rendered the bank's final answer.
   */
  async shownMessages(): Promise<string[]> {
    const texts = await this.errors.allTextContents();
    return texts.map((text) => text.replace(/\s+/g, ' ').trim());
  }
}
