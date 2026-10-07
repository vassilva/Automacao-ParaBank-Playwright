import type { Browser } from '@playwright/test';

/**
 * Lets a host test runner lend its browser to the Cucumber hooks.
 *
 * Native `cucumber-js` never sets it, so the hooks launch and close their own browser. The
 * Playwright Test entry point (playwright/cucumber.spec.ts) lends its `browser` fixture, so that
 * --headed, UI Mode's "Show browser" and Playwright's tracing apply to the scenarios. The browser
 * is the only thing lent: every scenario still gets its own context from the World, as in native
 * runs.
 */
let hosted: Browser | undefined;
let borrowed = false;

export function lendBrowser(browser: Browser | undefined): void {
  hosted = browser;
  borrowed = false;
}

export function hostedBrowser(): Browser | undefined {
  if (hosted) borrowed = true;
  return hosted;
}

/** Whether the hooks took the lent browser, so a silent fallback to their own launch is caught. */
export function lentBrowserWasUsed(): boolean {
  return borrowed;
}
