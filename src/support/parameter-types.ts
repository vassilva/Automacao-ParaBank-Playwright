import { defineParameterType } from '@cucumber/cucumber';
import { toCents } from '../utils/money';

/** A dollar amount written in Gherkin ("100", "0.01", "42.10"), converted to integer cents. */
defineParameterType({
  name: 'money',
  regexp: /\d+(?:\.\d{1,2})?/,
  transformer: (amount: string) => toCents(amount),
});

defineParameterType({
  name: 'accountRole',
  regexp: /primary|source|destination/,
  transformer: (role: string) => role,
});

/** Public destinations a visitor can reach from the home page. */
defineParameterType({
  name: 'entryPoint',
  regexp: /registration|login recovery/,
  transformer: (destination: string) => destination,
});

defineParameterType({
  name: 'accountType',
  regexp: /CHECKING|SAVINGS/,
  transformer: (type: string) => type,
});

/** Bill payment inputs validated individually (see BillPayPage.fieldErrors). */
defineParameterType({
  name: 'billPayField',
  regexp: /amount|payee account number|payee name/,
  transformer: (field: string) => field,
});

/** Find Transactions search criteria ("date range" listed before "date" so it wins). */
defineParameterType({
  name: 'searchCriterion',
  regexp: /transaction ID|date range|date|amount/,
  transformer: (criterion: string) => criterion,
});

/** Another customer's data a signed-in customer must not be able to read. */
defineParameterType({
  name: 'foreignResource',
  regexp: /accounts|profile|account transactions/,
  transformer: (resource: string) => resource,
});

/** Operations that would take money out of another customer's account. */
defineParameterType({
  name: 'foreignOperation',
  regexp: /a transfer to my account|a bill payment|a new account/,
  transformer: (operation: string) => operation,
});
