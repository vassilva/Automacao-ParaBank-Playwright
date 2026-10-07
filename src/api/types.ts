/** Shapes returned by ParaBank's `services_proxy/bank` JSON endpoints, as observed. */

export type AccountType = 'CHECKING' | 'SAVINGS' | 'LOAN';
export type OpenableAccountType = Exclude<AccountType, 'LOAN'>;

export interface Account {
  id: number;
  customerId: number;
  type: AccountType;
  balance: number;
}

export interface Transaction {
  id: number;
  accountId: number;
  type: 'Debit' | 'Credit';
  date: number;
  amount: number;
  description: string;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface Customer {
  id: number;
  firstName: string;
  lastName: string;
  address: Address;
  phoneNumber: string;
  ssn: string;
}
