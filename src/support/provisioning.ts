import { request } from '@playwright/test';
import { ParaBankClient } from '../api/parabank-client';
import { buildCustomerProfile, type CustomerProfile } from '../factories/customer.factory';
import { centsFromApi } from '../utils/money';
import { config } from './config';
import type { CustomerSession, OtherCustomer, ParaBankWorld } from './world';

/**
 * Registers a brand-new synthetic customer in its OWN HTTP session (separate cookie jar) and
 * reads back who the bank says it is. Registration through the UI has its own scenarios; here it
 * is setup, so the HTTP form submission is used to keep it fast.
 */
async function registerInOwnSession(profile: CustomerProfile) {
  const session = await request.newContext({ baseURL: config.baseURL });
  try {
    const bank = new ParaBankClient(session);
    await bank.registerCustomer(profile);
    const id = await bank.signedInCustomerId();
    const [primary, ...others] = await bank.getAccounts(id);
    if (!primary || others.length > 0) {
      throw new Error(`A new customer should own exactly one account, found ${others.length + 1}`);
    }
    return { session, bank, id, primary };
  } catch (error) {
    await session.dispose();
    throw error;
  }
}

/**
 * SETUP for every scenario that acts as a customer: a new customer of its own, never shared with
 * another scenario. The registration session is discarded, so the scenario's browser is still
 * signed out: signing in is a visible step of the scenario (see customer.steps.ts).
 */
export async function provisionRegisteredCustomer(
  world: ParaBankWorld,
  profile: CustomerProfile = buildCustomerProfile(),
): Promise<CustomerSession> {
  const { session, id, primary } = await registerInOwnSession(profile);
  await session.dispose();
  world.customer = {
    profile,
    id,
    primaryAccountId: primary.id,
    openingBalance: centsFromApi(primary.balance),
  };
  return world.customer;
}

/**
 * Registers a second, independent customer whose own session stays open, so the scenario's
 * customer and this one never share a session. Used to check that one customer cannot reach
 * another customer's data; the other customer's session only sets up and reads their state.
 */
export async function provisionOtherCustomer(world: ParaBankWorld): Promise<OtherCustomer> {
  const profile = buildCustomerProfile();
  const { session, bank, id, primary } = await registerInOwnSession(profile);
  world.otherCustomer = {
    profile,
    id,
    primaryAccountId: primary.id,
    bank,
    dispose: () => session.dispose(),
  };
  return world.otherCustomer;
}
