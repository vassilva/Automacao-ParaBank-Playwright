import type { Address } from '../api/types';
import { recordTestData } from '../support/test-data-audit';
import { nextSlot, payeeAccountNumberFor, phoneFor, stateFor, zipFor } from './test-data';

export interface Payee {
  name: string;
  address: Address;
  phoneNumber: string;
  accountNumber: string;
}

/** An external payee owned by one scenario: its own name, address, phone and account number. */
export function buildPayee(): Payee {
  const slot = nextSlot();
  const payee: Payee = {
    name: `Example Utility ${slot.tag}`,
    address: {
      street: `${slot.serial} Payee ${slot.tag} Avenue`,
      city: `Payeetown ${slot.tag}`,
      state: stateFor(slot, 12),
      zipCode: zipFor(slot, '00002'),
    },
    phoneNumber: phoneFor(slot),
    accountNumber: payeeAccountNumberFor(slot),
  };
  recordTestData('payee.name', payee.name);
  recordTestData('payee.street', payee.address.street);
  recordTestData('payee.accountNumber', payee.accountNumber);
  recordTestData('payee.phone', payee.phoneNumber);
  return payee;
}
