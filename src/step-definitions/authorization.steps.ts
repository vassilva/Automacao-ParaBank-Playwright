import { Given, Then, When } from '@cucumber/cucumber';
import type { APIResponse } from '@playwright/test';
import type { Account, Customer, Transaction } from '../api/types';
import { buildCustomerProfile } from '../factories/customer.factory';
import { buildPayee } from '../factories/payee.factory';
import { expect } from '../support/assertions';
import { captureLedger, ledgerFingerprint } from '../support/ledger';
import { outcomeCheck } from '../support/outcome-check';
import { provisionOtherCustomer } from '../support/provisioning';
import { requireValue } from '../support/require-value';
import type { OtherCustomer, ParaBankWorld } from '../support/world';

// Cross-customer access: the scenario's customer (actor A, browser session) uses another
// customer's identifiers (actor B). B's own session is used only to set up and read B's state.

type ForeignResource = 'accounts' | 'profile' | 'account transactions';
type ForeignOperation = 'a transfer to my account' | 'a bill payment' | 'a new account';

/** Statuses a bank may use to refuse access to data that is not the caller's. */
const REFUSALS = [401, 403, 404];

/** One dollar: the amount is irrelevant, any movement out of the other account is a breach. */
const PROBE_AMOUNT = 1_00;

function other(world: ParaBankWorld): OtherCustomer {
  return requireValue(world.otherCustomer, 'another customer');
}

async function remember(world: ParaBankWorld, response: APIResponse): Promise<void> {
  world.refusedRequestStatus = response.status();
  // The body is never kept or reported: it may hold the other customer's data.
  await response.dispose();
}

/**
 * Invariant for every cross-customer scenario: A (who sends the requests) and B (who owns the
 * target) are two different customers. Proven from non-secret identifiers read from the bank, not
 * from how the actors were created. Usernames are compared in memory and never printed.
 */
async function expectDistinctActors(world: ParaBankWorld): Promise<void> {
  const a = world.session;
  const b = other(world);
  // The identity behind A's own session: the one every cross-customer request is sent with.
  const requester = await world.bank.signedInCustomerId();
  const accountsOfB = await b.bank.getAccounts(b.id);
  expect(
    {
      requesterIsA: requester === a.id,
      distinctCustomerIds: a.id !== b.id,
      distinctUsernames: a.profile.username !== b.profile.username,
      accountsOfBOwnedByB:
        accountsOfB.length > 0 && accountsOfB.every((x) => x.customerId === b.id),
      noAccountOfAAmongB: !accountsOfB.some((x) => x.id === a.primaryAccountId),
    },
    `actor A (customer ${a.id}) and actor B (customer ${b.id}) must be distinct customers`,
  ).toEqual({
    requesterIsA: true,
    distinctCustomerIds: true,
    distinctUsernames: true,
    accountsOfBOwnedByB: true,
    noAccountOfAAmongB: true,
  });
}

Given('another customer has their own account', async function (this: ParaBankWorld) {
  const victim = await provisionOtherCustomer(this);
  // Activity B makes in B's own session, so B's transaction history is not empty: an empty
  // answer could never show whose data was returned.
  await victim.bank.openAccount(victim.id, 'SAVINGS', victim.primaryAccountId);
  if ((await victim.bank.getTransactions(victim.primaryAccountId)).length === 0) {
    throw new Error("The other customer's primary account should have transactions after setup");
  }
  await expectDistinctActors(this);
});

const sameIds = (a: { id: number }[], b: { id: number }[]) =>
  JSON.stringify(a.map((x) => x.id).sort()) === JSON.stringify(b.map((x) => x.id).sort());

/**
 * Whether a response to A is B's own data: compared, in memory, with what B sees of the same
 * resource in B's own session (an independent read). Only the comparison result is kept.
 */
async function disclosure(
  resource: ForeignResource,
  response: APIResponse,
  victim: OtherCustomer,
): Promise<{ records: number; isOwnersData: boolean }> {
  if (!response.ok()) return { records: 0, isOwnersData: false };
  const body: unknown = await response.json().catch(() => undefined);
  if (resource === 'accounts') {
    const received = Array.isArray(body) ? (body as Account[]) : [];
    const own = await victim.bank.getAccounts(victim.id);
    return {
      records: received.length,
      isOwnersData:
        received.length > 0 &&
        sameIds(received, own) &&
        received.every((x) => x.customerId === victim.id),
    };
  }
  if (resource === 'profile') {
    const received = (body ?? {}) as Partial<Customer>;
    const own = await victim.bank.getCustomer(victim.id);
    return {
      records: body ? 1 : 0,
      isOwnersData:
        received.id === victim.id &&
        received.firstName === own.firstName &&
        received.lastName === own.lastName &&
        received.ssn === own.ssn,
    };
  }
  const received = Array.isArray(body) ? (body as Transaction[]) : [];
  const own = await victim.bank.getTransactions(victim.primaryAccountId);
  return {
    records: received.length,
    isOwnersData:
      received.length > 0 &&
      sameIds(received, own) &&
      received.every((x) => x.accountId === victim.primaryAccountId),
  };
}

When(
  "I request that customer's {foreignResource}",
  async function (this: ParaBankWorld, resource: ForeignResource) {
    const victim = other(this);
    const { id, primaryAccountId } = victim;
    const response =
      resource === 'accounts'
        ? await this.bank.accountsResponse(id)
        : resource === 'profile'
          ? await this.bank.customerResponse(id)
          : await this.bank.transactionsResponse(primaryAccountId);
    this.foreignDisclosure = await disclosure(resource, response, victim);
    await remember(this, response);
  },
);

When(
  "I try {foreignOperation} funded from that customer's account",
  async function (this: ParaBankWorld, operation: ForeignOperation) {
    const victim = other(this);
    this.otherBaseline = await captureLedger(victim.bank, victim.id);
    const response =
      operation === 'a transfer to my account'
        ? await this.bank.transferResponse(
            victim.primaryAccountId,
            this.accountId('primary'),
            PROBE_AMOUNT,
          )
        : operation === 'a bill payment'
          ? await this.bank.billPayResponse(victim.primaryAccountId, PROBE_AMOUNT, buildPayee())
          : await this.bank.openAccountResponse(
              this.session.id,
              'CHECKING',
              victim.primaryAccountId,
            );
    await remember(this, response);
  },
);

When(
  'I try to rename that customer through the profile update',
  async function (this: ParaBankWorld) {
    const victim = other(this);
    this.otherProfileBefore = await victim.bank.getCustomer(victim.id);
    // The endpoint requires a username and password. A cannot know B's, so A sends fresh
    // synthetic ones: the request carries none of B's credentials, and the outcome is judged on
    // B's persisted profile only. The page sends the full profile; among B's profile data, only
    // the first name differs from B's stored one.
    const decoy = buildCustomerProfile();
    this.decoyCredentials = { username: decoy.username, password: decoy.password };
    this.requestedProfileChange = { firstName: 'Renamed' };
    await remember(
      this,
      await this.bank.updateProfileResponse(
        victim.id,
        { ...victim.profile, ...this.decoyCredentials },
        this.requestedProfileChange,
      ),
    );
  },
);

Then('the bank should refuse the request', async function (this: ParaBankWorld) {
  const status = requireValue(this.refusedRequestStatus, 'status of the request');
  const disclosed = this.foreignDisclosure;
  // For a read, a non-refusal proves a breach only if the answer is the other customer's data.
  if (!REFUSALS.includes(status) && disclosed && !disclosed.isOwnersData) {
    throw new Error(
      `HTTP ${status} answered to another customer's request, but the answer is not that ` +
        `customer's data (${disclosed.records} record(s)): no evidence either way`,
    );
  }
  const evidence = disclosed?.isOwnersData
    ? `, returning ${disclosed.records} record(s) identical to that customer's own view`
    : '';
  await outcomeCheck('request-refused', () =>
    expect(REFUSALS, `HTTP ${status} answered to another customer's request${evidence}`).toContain(
      status,
    ),
  );
});

Then("the other customer's accounts should be unchanged", async function (this: ParaBankWorld) {
  const victim = other(this);
  const before = requireValue(this.otherBaseline, "the other customer's ledger before");
  const after = await captureLedger(victim.bank, victim.id);
  // Every account's type, balance and transactions, and the set of accounts itself.
  await outcomeCheck('other-ledger-unchanged', () =>
    expect(ledgerFingerprint(after)).toEqual(ledgerFingerprint(before)),
  );
});

Then("the other customer's profile should be unchanged", async function (this: ParaBankWorld) {
  const victim = other(this);
  const before = requireValue(this.otherProfileBefore, "the other customer's profile before");
  // Read in B's own session: B's persisted profile, as B sees it.
  const stored = await victim.bank.getCustomer(victim.id);
  if (stored.id !== victim.id || before.id !== victim.id) {
    throw new Error(`The profile read is not the one of customer ${victim.id}`);
  }
  // Every field is compared in memory; the evidence states only what happened to each field
  // (no profile values), and whether a change is the one A requested.
  const requested = requireValue(this.requestedProfileChange, 'requested profile change');
  const state = (field: 'firstName' | 'lastName' | 'address' | 'ssn') => {
    const now = JSON.stringify(stored[field]);
    if (now === JSON.stringify(before[field])) return 'unchanged';
    const sent = field === 'firstName' || field === 'lastName' ? requested[field] : undefined;
    return sent !== undefined && now === JSON.stringify(sent)
      ? 'changed to the value sent by customer A'
      : 'changed';
  };
  await outcomeCheck('other-profile-unchanged', () =>
    expect(
      {
        firstName: state('firstName'),
        lastName: state('lastName'),
        address: state('address'),
        ssn: state('ssn'),
      },
      `customer B's (${victim.id}) persisted profile after customer A's (${this.session.id}) update`,
    ).toEqual({
      firstName: 'unchanged',
      lastName: 'unchanged',
      address: 'unchanged',
      ssn: 'unchanged',
    }),
  );
});
