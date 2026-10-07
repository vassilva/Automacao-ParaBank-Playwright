import { Given, Then } from '@cucumber/cucumber';
import { expect } from '../support/assertions';
import { OPENING_DEPOSIT } from '../support/bank-rules';
import { provisionRegisteredCustomer } from '../support/provisioning';
import type { ParaBankWorld } from '../support/world';

// Customer preconditions and the authenticated session lifecycle shared by several features:
//   SETUP    I am a registered ParaBank customer who is signed out   (own new customer)
//   LOGIN    I sign in with my credentials                           (authentication.steps.ts)
//   VERIFIED I am signed in as that customer                         (proven, see below)
//   ...      the scenario's action and business outcomes
//   LOGOUT   I sign out                                              (authentication.steps.ts)
//   VERIFIED my banking session should be ended                      (proven, see below)

Given(
  'I am a registered ParaBank customer who is signed out',
  async function (this: ParaBankWorld) {
    await provisionRegisteredCustomer(this);
  },
);

Then('I am signed in as that customer', async function (this: ParaBankWorld) {
  const { id, primaryAccountId, profile } = this.session;
  // The page: the signed-in customer menu, greeting this customer.
  await expect(this.pages.menu.logOutLink).toBeVisible();
  await expect(this.pages.menu.welcome).toHaveText(
    `Welcome ${profile.firstName} ${profile.lastName}`,
  );
  // The bank: the identity behind the browser's own session is the registered customer, and the
  // session reads that customer's accounts. Names are shared by all synthetic customers, so the
  // customer id is the identity proof.
  const sessionCustomerId = await this.bank.signedInCustomerId();
  const accounts = await this.bank.getAccounts(id);
  expect(
    {
      sessionIsThisCustomer: sessionCustomerId === id,
      accountsOwnedByThisCustomer:
        accounts.length > 0 && accounts.every((account) => account.customerId === id),
      primaryAccountPresent: accounts.some((account) => account.id === primaryAccountId),
    },
    `signed-in session of customer ${id}`,
  ).toEqual({
    sessionIsThisCustomer: true,
    accountsOwnedByThisCustomer: true,
    primaryAccountPresent: true,
  });
  this.attach(
    `LOGIN VERIFIED: the browser session belongs to customer ${id}; ` +
      `${accounts.length} account(s) of that customer readable`,
    'text/plain',
  );
});

Then('my banking session should be ended', async function (this: ParaBankWorld) {
  const { id } = this.session;
  // The page: back to the public sign-in form, no customer menu.
  await expect(this.pages.home.loginHeading).toBeVisible();
  await expect(this.pages.menu.logOutLink).toBeHidden();
  // The bank: the same browser session can no longer read the customer's accounts. (A click on
  // Log Out alone proves nothing; a still-valid server session would answer 200 here.)
  const response = await this.bank.accountsResponse(id);
  const status = response.status();
  await response.dispose();
  expect(status, `accounts of customer ${id} for this browser session after signing out`).toBe(401);
  this.attach(
    `LOGOUT VERIFIED: customer ${id}'s accounts answer HTTP 401 to this browser session`,
    'text/plain',
  );
});

Given('I have two eligible accounts', async function (this: ParaBankWorld) {
  // Setup through the bank API: opening accounts through the UI has its own scenarios.
  const { id, primaryAccountId, openingBalance } = this.session;
  const second = await this.bank.openAccount(id, 'CHECKING', primaryAccountId);
  this.secondaryAccountId = second.id;
  // The test's own model of the result (the createAccount response is not trusted: it reports a
  // zero balance although the persisted balance is the deposit).
  this.expectedSetupBalances = new Map([
    [primaryAccountId, openingBalance - OPENING_DEPOSIT],
    [second.id, OPENING_DEPOSIT],
  ]);
});

Then('I should be greeted by my name', async function (this: ParaBankWorld) {
  const { firstName, lastName } = this.activeProfile;
  await expect(this.pages.menu.welcome).toHaveText(`Welcome ${firstName} ${lastName}`);
  await expect(this.pages.menu.logOutLink).toBeVisible();
});

Then('I should be offered the customer sign-in form', async function (this: ParaBankWorld) {
  await expect(this.pages.home.loginHeading).toBeVisible();
});

Then('I should not be signed in', async function (this: ParaBankWorld) {
  await expect(this.pages.home.loginHeading).toBeVisible();
  await expect(this.pages.menu.logOutLink).toBeHidden();
});

Then('I should not have access to my accounts', async function (this: ParaBankWorld) {
  await expect(this.pages.menu.logOutLink).toBeHidden();
  // The UI alone could hide a still-valid session, so ask the bank directly.
  const response = await this.bank.accountsResponse(this.session.id);
  expect(response.status(), 'accounts endpoint status for this browser session').toBe(401);
});
