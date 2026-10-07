import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  After,
  AfterAll,
  Before,
  BeforeAll,
  BeforeStep,
  setDefaultTimeout,
  Status,
} from '@cucumber/cucumber';
import { PickleStepType } from '@cucumber/messages';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { hostedBrowser } from './browser-host';
import { config } from './config';
import { redact } from './redaction';
import { setAuditScenario, writeTestDataAudit } from './test-data-audit';
import type { ParaBankWorld } from './world';

setDefaultTimeout(config.timeouts.scenario);

// One browser per run; each scenario gets its own isolated context. Under Playwright Test the
// browser is lent by its `browser` fixture (see browser-host.ts), so Playwright owns its launch
// options (--headed, UI Mode) and tracing; native cucumber-js launches its own.
let browser: Browser | undefined;
let ownsBrowser = false;
// Playwright Test records its own trace of the lent browser; starting a second one would fail.
let ownTracing = false;

BeforeAll(async function () {
  const lent = hostedBrowser();
  ownsBrowser = !lent;
  ownTracing = config.traceOnFailure && ownsBrowser;
  browser = lent ?? (await chromium.launch({ headless: config.headless, slowMo: config.slowMo }));
});

Before(async function (this: ParaBankWorld, { pickle }) {
  if (!browser) throw new Error('Browser was not launched');
  // Attributes generated test data to this scenario (opt-in audit, fingerprints only).
  setAuditScenario(`${pickle.uri.split('\\').join('/')}:${pickle.location?.line ?? 0}`);
  await this.openBrowserContext(browser, pickle.name);
  if (ownTracing) {
    await this.context.tracing.start({ screenshots: true, snapshots: true });
  }
});

// A settled outcome belongs to the action that produced it: any later Given or When step may
// change the page, so only Then steps directly after the settling action can rely on it.
BeforeStep(function (this: ParaBankWorld, { pickleStep }) {
  if (pickleStep.type !== PickleStepType.OUTCOME) this.outcomeSettled = false;
});

After(async function (this: ParaBankWorld, { result, pickle, testCaseStartedId }) {
  await this.otherCustomer?.dispose();
  if (!this.context) return;
  const failed = result?.status === Status.FAILED;
  const secrets = this.sensitiveValues();
  try {
    if (failed) {
      const screenshot = await this.page
        .screenshot({ fullPage: true, mask: sensitiveRegions(this.page, secrets) })
        .catch(() => undefined);
      if (screenshot) this.attach(screenshot, 'image/png');
      // The path only: ParaBank can append ";jsessionid=..." to it, which redact() removes.
      this.attach(redact(`Failed at ${new URL(this.page.url()).pathname}`, secrets), 'text/plain');
      if (this.edgeRejections.length > 0) {
        const rejections = redact(this.edgeRejections.join('\n'), secrets);
        this.attach(
          `Environment instability: the edge proxy rejected ${this.edgeRejections.length} ` +
            `request(s) during this scenario:\n${rejections}`,
          'text/plain',
        );
      }
    }
    if (ownTracing) {
      const tracePath = failed
        ? path.join(config.reportsDir, 'traces', `${slug(pickle.name)}-${testCaseStartedId}.zip`)
        : undefined;
      if (tracePath) await mkdir(path.dirname(tracePath), { recursive: true });
      await this.context.tracing.stop({ path: tracePath });
    }
  } finally {
    await this.context.close();
    this.traffic?.write(result?.status ?? 'UNKNOWN');
  }
});

AfterAll(async function () {
  writeTestDataAudit(config.reportsDir);
  if (ownsBrowser) await browser?.close();
  browser = undefined;
});

/**
 * Everything a failure screenshot must not show, masked before the image is captured: credential
 * and identity inputs on every form
 * (sign-in, registration, profile, login recovery) and the login-recovery result, which prints
 * the customer's username and password as text.
 */
function sensitiveRegions(page: Page, secrets: readonly string[]): Locator[] {
  return [
    page.locator('input[type="password"]'),
    page.locator('input[name="username"], input[name$=".username"]'),
    page.locator('input[name="ssn"], input[name$=".ssn"]'),
    page.locator('#rightPanel p').filter({ hasText: /Password/ }),
    // Registration's result greets the new customer by username ("Welcome <username>").
    page.locator('#rightPanel h1').filter({ hasText: /^\s*Welcome\b/ }),
    // Any other text showing one of this scenario's credentials or identity numbers.
    ...secrets.filter((secret) => secret.length >= 4).map((secret) => page.getByText(secret)),
  ];
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
