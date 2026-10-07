import { Then, When } from '@cucumber/cucumber';
import type { Customer } from '../api/types';
import { buildContactDetails } from '../factories/customer.factory';
import { expect } from '../support/assertions';
import type { ParaBankWorld } from '../support/world';

/** Profile without the SSN, so a failing comparison never prints identity numbers. */
function withoutSsn({ ssn, ...rest }: Customer): Omit<Customer, 'ssn'> {
  return rest;
}

function profileBefore(world: ParaBankWorld): Customer {
  if (!world.profileBefore) throw new Error('The stored profile was not captured before acting');
  return world.profileBefore;
}

When('I change my address and phone number', async function (this: ParaBankWorld) {
  this.profileBefore = await this.bank.getCustomer(this.session.id);
  this.contactUpdate = buildContactDetails();
  await this.pages.updateProfile.open();
  await this.pages.updateProfile.changeContactDetails(this.contactUpdate);
  await this.pages.updateProfile.save();
});

When('I try to save my profile without a first name', async function (this: ParaBankWorld) {
  this.profileBefore = await this.bank.getCustomer(this.session.id);
  await this.pages.updateProfile.open();
  await this.pages.updateProfile.clearFirstName();
  await this.pages.updateProfile.submit();
});

When(
  'I try to save my profile with every mandatory detail cleared',
  async function (this: ParaBankWorld) {
    this.profileBefore = await this.bank.getCustomer(this.session.id);
    await this.pages.updateProfile.open();
    await this.pages.updateProfile.clearMandatoryDetails();
    await this.pages.updateProfile.submit();
  },
);

When('I remove my phone number from my profile', async function (this: ParaBankWorld) {
  this.profileBefore = await this.bank.getCustomer(this.session.id);
  await this.pages.updateProfile.open();
  await this.pages.updateProfile.clearPhoneNumber();
  await this.pages.updateProfile.save();
});

When(
  'I try to save my profile with a first name made only of spaces',
  async function (this: ParaBankWorld) {
    this.profileBefore = await this.bank.getCustomer(this.session.id);
    await this.pages.updateProfile.open();
    await this.pages.updateProfile.setFirstName('   ');
    await this.pages.updateProfile.submit();
    // Either outcome ends the action: a validation message (the correct behavior) or the bank's
    // confirmation (what ParaBank currently does).
    await this.pages.updateProfile.confirmationHeading
      .or(this.pages.feedback.errors.first())
      .waitFor();
    this.outcomeSettled = true;
  },
);

Then('I should be told my profile was updated', async function (this: ParaBankWorld) {
  await expect(this.pages.updateProfile.confirmationHeading).toBeVisible();
});

Then(
  'my customer profile should hold the new address and phone number',
  async function (this: ParaBankWorld) {
    const stored = await this.bank.getCustomer(this.session.id);
    expect({ address: stored.address, phoneNumber: stored.phoneNumber }).toEqual(
      this.contactUpdate,
    );
  },
);

Then('my name and identity details should be unchanged', async function (this: ParaBankWorld) {
  const before = profileBefore(this);
  const stored = await this.bank.getCustomer(this.session.id);
  expect({ firstName: stored.firstName, lastName: stored.lastName, id: stored.id }).toEqual({
    firstName: before.firstName,
    lastName: before.lastName,
    id: before.id,
  });
  expect(stored.ssn === before.ssn, 'SSN should be unchanged').toBe(true);
});

Then(
  'my customer profile should have no phone number and be otherwise unchanged',
  async function (this: ParaBankWorld) {
    const before = profileBefore(this);
    const stored = await this.bank.getCustomer(this.session.id);
    expect(stored.phoneNumber, 'stored phone number').toBe('');
    expect(withoutSsn({ ...stored, phoneNumber: before.phoneNumber })).toEqual(withoutSsn(before));
    expect(stored.ssn === before.ssn, 'SSN should be unchanged').toBe(true);
  },
);

Then('my customer profile should be unchanged', async function (this: ParaBankWorld) {
  const before = profileBefore(this);
  expect(this.bankSubmissions.filter((path) => path.includes('/customers/update/'))).toEqual([]);
  const stored = await this.bank.getCustomer(this.session.id);
  expect(withoutSsn(stored)).toEqual(withoutSsn(before));
  expect(stored.ssn === before.ssn, 'SSN should be unchanged').toBe(true);
});
