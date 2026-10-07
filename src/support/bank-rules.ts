import type { Cents } from '../utils/money';

/**
 * Amount moved from the funding account into a newly opened account.
 * OBSERVED BEHAVIOR, also stated on ParaBank's Open New Account page ("A minimum of $100.00 must
 * be deposited into this account at time of opening"). It is configurable on ParaBank's public
 * admin page ("Min. Balance"), so a failure here may be configuration drift, not a defect.
 */
export const OPENING_DEPOSIT: Cents = 100_00;
