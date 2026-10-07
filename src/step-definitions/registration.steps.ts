import { Given, Then, When } from '@cucumber/cucumber';
import { buildCustomerProfile, wrongPasswordFor } from '../factories/customer.factory';
import { nextSlot, usernameOfLength } from '../factories/test-data';
import { expect } from '../support/assertions';
import { outcomeCheck } from '../support/outcome-check';
import type { ParaBankWorld } from '../support/world';
import { formatUsd, toCents } from '../utils/money';

Given('another customer has already registered a username', async function (this: ParaBankWorld) {
  const existing = buildCustomerProfile();
  await this.bank.registerCustomer(existing);
  // Registration signs that customer in; drop the session so this visitor starts anonymous.
  await this.context.clearCookies();
  this.takenUsername = existing.username;
});

Given('another customer has already registered with an SSN', async function (this: ParaBankWorld) {
  const existing = buildCustomerProfile();
  await this.bank.registerCustomer(existing);
  // Registration signs that customer in; drop the session so this visitor starts anonymous.
  await this.context.clearCookies();
  this.takenSsn = existing.ssn;
});

When('I register with that same SSN', async function (this: ParaBankWorld) {
  this.registrationAttempt = buildCustomerProfile({ ssn: this.takenSsn });
  await this.pages.registration.register(this.registrationAttempt);
  // The answer is server-rendered and the action waited for that page to load.
  this.outcomeSettled = true;
});

When(
  'I register with a username of (exactly ){int} characters',
  async function (this: ParaBankWorld, length: number) {
    // The scenario's own unique username, padded deterministically to the exact length.
    const slot = nextSlot();
    const username = usernameOfLength(slot, length);
    this.registrationAttempt = buildCustomerProfile({ username }, slot);
    await this.pages.registration.register(this.registrationAttempt);
    // The answer is server-rendered and the action waited for that page to load.
    this.outcomeSettled = true;
  },
);

When(
  'I register with a first and last name made only of spaces',
  async function (this: ParaBankWorld) {
    this.registrationAttempt = buildCustomerProfile({ firstName: '   ', lastName: '   ' });
    await this.pages.registration.register(this.registrationAttempt);
    // The answer is server-rendered and the action waited for that page to load.
    this.outcomeSettled = true;
  },
);

Then(
  'my online banking registration should not be confirmed',
  async function (this: ParaBankWorld) {
    const { successMessage } = this.pages.registration;
    await outcomeCheck('registration-not-confirmed', async () => {
      if (this.outcomeSettled) {
        expect(await successMessage.isVisible(), 'registration confirmation shown').toBe(false);
      } else {
        await expect(successMessage).toBeHidden();
      }
    });
  },
);

Then('I should not be told that the username already exists', async function (this: ParaBankWorld) {
  const taken = this.pages.feedback.errors.filter({ hasText: 'This username already exists.' });
  await outcomeCheck('no-username-taken-message', async () => {
    if (this.outcomeSettled) {
      expect(await taken.count(), '"This username already exists." messages shown').toBe(0);
    } else {
      await expect(taken).toHaveCount(0);
    }
  });
});

When(
  'I register with valid personal details and unique credentials',
  async function (this: ParaBankWorld) {
    this.registrationAttempt = buildCustomerProfile();
    await this.pages.registration.register(this.registrationAttempt);
  },
);

When(
  'I register with a password confirmation that does not match',
  async function (this: ParaBankWorld) {
    const profile = buildCustomerProfile();
    this.registrationAttempt = profile;
    await this.pages.registration.register(profile, wrongPasswordFor(profile));
  },
);

When('I register with that same username', async function (this: ParaBankWorld) {
  this.registrationAttempt = buildCustomerProfile({ username: this.takenUsername });
  await this.pages.registration.register(this.registrationAttempt);
});

When('I submit the registration form without any details', async function (this: ParaBankWorld) {
  await this.pages.registration.submit();
});

Then('my online banking registration should be confirmed', async function (this: ParaBankWorld) {
  const { registration } = this.pages;
  await expect(registration.welcomeHeading(this.activeProfile.username)).toBeVisible();
  await expect(registration.successMessage).toBeVisible();
});

Then(
  'my accounts overview should list exactly one account with a positive balance',
  async function (this: ParaBankWorld) {
    const { accounts } = await this.pages.overview.open();
    expect(accounts, 'accounts the bank holds for the new customer').toHaveLength(1);
    const [account] = accounts;
    const balance = toCents(account?.balance ?? NaN);
    expect(balance).toBeGreaterThan(0);
    expect(await this.pages.overview.readRows()).toEqual([
      {
        accountId: String(account?.id),
        balance: formatUsd(balance),
        available: formatUsd(balance),
      },
    ]);
  },
);

Then('the phone number should be optional', async function (this: ParaBankWorld) {
  await expect(this.pages.registration.phoneRow).not.toContainText(/required/i);
});
