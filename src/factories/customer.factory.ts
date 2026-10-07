import { randomBytes } from 'node:crypto';
import type { Address } from '../api/types';
import { protectValues } from '../support/redaction';
import { recordTestData } from '../support/test-data-audit';
import {
  nextSlot,
  nextSsn,
  phoneFor,
  stateFor,
  usernameFor,
  zipFor,
  type DataSlot,
} from './test-data';

/**
 * Synthetic data only, owned by one scenario: every customer gets its own names, address, phone,
 * SSN (never-issued 000 area), username and password (see test-data.ts). Credentials and SSNs are
 * registered for redaction when they are created and never logged.
 */
export interface CustomerProfile {
  firstName: string;
  lastName: string;
  address: Address;
  phoneNumber: string;
  ssn: string;
  username: string;
  password: string;
}

export interface ContactDetails {
  address: Address;
  phoneNumber: string;
}

/** A fictional phone number of its own (555-01xx range, unique extension). */
export const fictionalPhoneNumber = (): string => phoneFor(nextSlot());

/** URL-safe alphabet: ParaBank puts the password, unencoded, into a query string on profile update. */
const randomPassword = (): string => `Pw${randomBytes(12).toString('base64url')}`;

export function buildCustomerProfile(
  overrides: Partial<CustomerProfile> = {},
  slot: DataSlot = nextSlot(),
): CustomerProfile {
  const profile: CustomerProfile = {
    firstName: `Test${slot.tag}`,
    lastName: `Synthetic${slot.tag}`,
    address: {
      street: `${slot.serial} Example ${slot.tag} Street`,
      city: `Testville ${slot.tag}`,
      state: stateFor(slot),
      zipCode: zipFor(slot),
    },
    phoneNumber: phoneFor(slot),
    ssn: overrides.ssn ?? nextSsn(),
    username: usernameFor(slot),
    password: randomPassword(),
    ...overrides,
  };
  // Registered at creation, so no step can forget to: masked in every report from now on.
  protectValues(profile.username, profile.password, profile.ssn);
  recordProfile(profile, overrides);
  return profile;
}

/** Run-time uniqueness audit (fingerprints only, opt-in): see src/support/test-data-audit.ts. */
function recordProfile(profile: CustomerProfile, overrides: Partial<CustomerProfile>): void {
  const origin = (field: keyof CustomerProfile) => (field in overrides ? 'provided' : 'generated');
  recordTestData('customer.username', profile.username, origin('username'));
  recordTestData('customer.password', profile.password, origin('password'));
  recordTestData('customer.ssn', profile.ssn, origin('ssn'));
  recordTestData('customer.firstName', profile.firstName, origin('firstName'));
  recordTestData('customer.lastName', profile.lastName, origin('lastName'));
  recordTestData(
    'customer.fullName',
    `${profile.firstName} ${profile.lastName}`,
    'firstName' in overrides || 'lastName' in overrides ? 'provided' : 'generated',
  );
  recordTestData('customer.street', profile.address.street, origin('address'));
  recordTestData('customer.city', profile.address.city, origin('address'));
  recordTestData('customer.state', profile.address.state, origin('address'));
  recordTestData('customer.zipCode', profile.address.zipCode, origin('address'));
  recordTestData('customer.phone', profile.phoneNumber, origin('phoneNumber'));
}

/** A new address and phone for a profile update, distinct from every customer's own. */
export function buildContactDetails(slot: DataSlot = nextSlot()): ContactDetails {
  const details: ContactDetails = {
    address: {
      street: `${slot.serial} Updated ${slot.tag} Road`,
      city: `Sampletown ${slot.tag}`,
      state: stateFor(slot, 25),
      zipCode: zipFor(slot, '00001'),
    },
    phoneNumber: phoneFor(slot),
  };
  recordTestData('contact.street', details.address.street);
  recordTestData('contact.city', details.address.city);
  recordTestData('contact.state', details.address.state);
  recordTestData('contact.zipCode', details.address.zipCode);
  recordTestData('contact.phone', details.phoneNumber);
  return details;
}

/** A password guaranteed to differ from the customer's real one. */
export const wrongPasswordFor = (profile: CustomerProfile): string => `${profile.password}x`;
