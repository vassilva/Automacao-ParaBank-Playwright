import { Given, Then, When } from '@cucumber/cucumber';
import { fictionalPhoneNumber } from '../factories/customer.factory';
import { expect } from '../support/assertions';
import { requireValue } from '../support/require-value';
import type { ParaBankWorld } from '../support/world';

type EntryPoint = 'registration' | 'login recovery';

Given('I am a visitor on the ParaBank home page', async function (this: ParaBankWorld) {
  await this.pages.home.open();
});

Given('I am a visitor on the registration page', async function (this: ParaBankWorld) {
  await this.pages.registration.open();
});

Given('I am a visitor on the login recovery page', async function (this: ParaBankWorld) {
  await this.pages.customerLookup.open();
});

When(
  'I follow the {entryPoint} entry point',
  async function (this: ParaBankWorld, destination: EntryPoint) {
    const { home } = this.pages;
    await (destination === 'registration' ? home.registerLink : home.forgotLoginLink).click();
  },
);

Then(
  'I should arrive at the {entryPoint} page',
  async function (this: ParaBankWorld, destination: EntryPoint) {
    if (destination === 'registration') {
      await expect(this.page).toHaveURL(/register\.htm/);
      await expect(this.pages.registration.heading).toBeVisible();
    } else {
      await expect(this.page).toHaveURL(/lookup\.htm/);
      await expect(this.pages.customerLookup.heading).toBeVisible();
    }
  },
);

Given('I am a visitor on the customer care page', async function (this: ParaBankWorld) {
  await this.pages.customerCare.open();
});

When(
  'I send customer care a message with my contact details',
  async function (this: ParaBankWorld) {
    // Synthetic contact details: the reserved example.com domain and the fictional 555-01xx range.
    this.careMessage = {
      name: 'Synthetic Visitor',
      email: 'visitor@example.com',
      phone: fictionalPhoneNumber(),
      message: 'Please call me about opening a savings account.',
    };
    await this.pages.customerCare.send(this.careMessage);
  },
);

When('I send customer care an empty message', async function (this: ParaBankWorld) {
  await this.pages.customerCare.send();
});

Then(
  'customer care should thank me by name and promise to contact me',
  async function (this: ParaBankWorld) {
    const { customerCare } = this.pages;
    const name = requireValue(this.careMessage, 'customer care message').name;
    await expect(customerCare.thanks(name)).toBeVisible();
    await expect(customerCare.representativeNotice).toBeVisible();
    await expect(this.pages.feedback.errors).toHaveCount(0);
  },
);

When(
  'I request my login information without providing any details',
  async function (this: ParaBankWorld) {
    await this.pages.customerLookup.submitEmpty();
  },
);
