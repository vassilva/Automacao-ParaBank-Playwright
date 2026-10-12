// Runtime contracts of the ParaBank JSON responses (src/api/contracts.ts). Fixtures are synthetic
// and shaped like the real services_proxy answers; messages must name fields, never values.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ContractViolation,
  parseAccount,
  parseAccounts,
  parseCustomer,
  parseTransactions,
} from '../../../src/api/contracts';

const account = { id: 13344, customerId: 12212, type: 'CHECKING', balance: 515.5 };
const transaction = {
  id: 14476,
  accountId: 13344,
  type: 'Debit',
  date: 1791830000000,
  amount: 128.45,
  description: 'Funds Transfer Sent',
};
const SECRET_SSN = '000-12-3456';
const customer = {
  id: 12212,
  firstName: 'TestAbcd',
  lastName: 'SyntheticAbcd',
  address: { street: '1 Example Street', city: 'Testville', state: 'CA', zipCode: '00000-0001' },
  phoneNumber: '555-0101 x1',
  ssn: SECRET_SSN,
};

/** Asserts a ContractViolation naming `path`; returns the message for further checks. */
function violation(run: () => unknown, path: string): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ContractViolation, 'expected a ContractViolation');
    assert.ok(error.message.includes(path), `the message should name ${path}`);
    return error.message;
  }
  assert.fail(`expected a contract violation at ${path}`);
}

describe('accounts', () => {
  it('accepts valid accounts of every type, keeping extra fields', () => {
    const types = ['CHECKING', 'SAVINGS', 'LOAN'];
    const parsed = parseAccounts(
      types.map((type, i) => ({ ...account, id: account.id + i, type, extra: 1 })),
    );
    assert.deepEqual(
      parsed.map((a) => a.type),
      types,
    );
    assert.equal((parsed[0] as unknown as { extra: number }).extra, 1);
  });

  it('accepts an empty list and a zero or negative balance', () => {
    assert.deepEqual(parseAccounts([]), []);
    assert.equal(parseAccount({ ...account, balance: 0 }).balance, 0);
    assert.equal(parseAccount({ ...account, balance: -12.5 }).balance, -12.5);
  });

  for (const [name, broken, path] of [
    ['missing id', { ...account, id: undefined }, 'account.id'],
    ['null customerId', { ...account, customerId: null }, 'account.customerId'],
    ['string id', { ...account, id: '13344' }, 'account.id'],
    ['fractional id', { ...account, id: 1.5 }, 'account.id'],
    ['unknown type', { ...account, type: 'CREDIT' }, 'account.type'],
    ['string balance', { ...account, balance: '515.50' }, 'account.balance'],
    ['NaN balance', { ...account, balance: Number.NaN }, 'account.balance'],
  ] as const) {
    it(`rejects an account with ${name}`, () => {
      violation(() => parseAccount(broken), path);
    });
  }

  it('rejects a non-array list and reports the failing element by index', () => {
    violation(() => parseAccounts({ accounts: [] }), 'accounts');
    violation(() => parseAccounts([account, { ...account, balance: null }]), 'accounts[1].balance');
  });
});

describe('transactions', () => {
  it('accepts valid debit and credit transactions', () => {
    const parsed = parseTransactions([transaction, { ...transaction, id: 14477, type: 'Credit' }]);
    assert.equal(parsed.length, 2);
  });

  for (const [name, broken, path] of [
    ['unknown type', { ...transaction, type: 'Refund' }, 'transactions[0].type'],
    ['string amount', { ...transaction, amount: '128.45' }, 'transactions[0].amount'],
    ['missing date', { ...transaction, date: undefined }, 'transactions[0].date'],
    ['null description', { ...transaction, description: null }, 'transactions[0].description'],
    ['missing accountId', { ...transaction, accountId: undefined }, 'transactions[0].accountId'],
  ] as const) {
    it(`rejects a transaction with ${name}`, () => {
      violation(() => parseTransactions([broken]), path);
    });
  }
});

describe('customer', () => {
  it('accepts a valid customer, including a blank optional phone number', () => {
    assert.equal(parseCustomer(customer).id, customer.id);
    assert.equal(parseCustomer({ ...customer, phoneNumber: '' }).phoneNumber, '');
  });

  for (const [name, broken, path] of [
    ['missing address', { ...customer, address: undefined }, 'customer.address'],
    ['address as a string', { ...customer, address: '1 Example Street' }, 'customer.address'],
    [
      'null zip code',
      { ...customer, address: { ...customer.address, zipCode: null } },
      'customer.address.zipCode',
    ],
    ['numeric ssn', { ...customer, ssn: 123 }, 'customer.ssn'],
    ['null phone number', { ...customer, phoneNumber: null }, 'customer.phoneNumber'],
    ['missing last name', { ...customer, lastName: undefined }, 'customer.lastName'],
  ] as const) {
    it(`rejects a customer with ${name}`, () => {
      violation(() => parseCustomer(broken), path);
    });
  }
});

describe('malformed answers and evidence safety', () => {
  for (const [name, body] of [
    ['null', null],
    ['a string (HTML error page)', '<html>Error</html>'],
    ['a number', 42],
    ['an array instead of an object', [customer]],
  ] as const) {
    it(`rejects ${name} where an object is expected`, () => {
      violation(() => parseCustomer(body), 'customer');
    });
  }

  it('never puts a response value into the violation message', () => {
    const message = violation(() => parseCustomer({ ...customer, ssn: 123456789 }), 'customer.ssn');
    assert.ok(!message.includes('123456789'), 'a value leaked into the message');
    const other = violation(
      () => parseCustomer({ ...customer, lastName: null }),
      'customer.lastName',
    );
    assert.ok(!other.includes(SECRET_SSN) && !other.includes('TestAbcd'), 'customer data leaked');
  });
});

describe('client integration (src/api/parabank-client.ts)', () => {
  /** A minimal APIRequestContext whose every answer is `body` with HTTP 200. */
  const fakeRequest = (body: unknown) =>
    ({
      fetch: () =>
        Promise.resolve({
          ok: () => true,
          status: () => 200,
          headers: () => ({}),
          json: () => (body instanceof Error ? Promise.reject(body) : Promise.resolve(body)),
          dispose: () => Promise.resolve(),
        }),
    }) as unknown as import('@playwright/test').APIRequestContext;

  it('returns validated data for a conforming answer', async () => {
    const { ParaBankClient } = await import('../../../src/api/parabank-client');
    const accounts = await new ParaBankClient(fakeRequest([account])).getAccounts(12212);
    assert.equal(accounts[0]?.id, account.id);
  });

  it('names the failed call and field, never a value, for a malformed answer', async () => {
    const { ParaBankClient } = await import('../../../src/api/parabank-client');
    const client = new ParaBankClient(fakeRequest({ ...customer, ssn: null }));
    await assert.rejects(
      () => client.getCustomer(12212),
      (error: Error) =>
        error instanceof ContractViolation &&
        error.message.includes('could not read the customer profile') &&
        error.message.includes('customer.ssn') &&
        !error.message.includes('TestAbcd'),
    );
  });

  it('reports a non-JSON answer as such', async () => {
    const { ParaBankClient } = await import('../../../src/api/parabank-client');
    const client = new ParaBankClient(fakeRequest(new SyntaxError('Unexpected token <')));
    await assert.rejects(() => client.getTransactions(13344), /the answer is not JSON/);
  });
});
