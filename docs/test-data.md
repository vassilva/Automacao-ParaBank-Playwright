# Test data: each scenario owns its data

Audit and refactoring of 2026-10-07 (Functional Automation Baseline v2: 77 scenarios, unchanged).

## Principle

Every scenario creates and owns the data it uses; nothing is shared between scenarios and no
scenario depends on another. Values are **unique where repetition is not needed**, and **repeated
on purpose where the repetition is the point**: boundaries, minimal comparison pairs, documented
known-defect reproductions, business rules and values ParaBank controls. Unique does not mean
random: values are deterministic and traceable.

## How values are generated

All generated values come from one allocator, `src/factories/test-data.ts`. Each record (a
customer, a payee, a contact change) gets a **slot**: a run token (process start time, so values
differ from every earlier run) plus a serial (so values differ within the run).

| Value             | Strategy                                                                            |
| ----------------- | ----------------------------------------------------------------------------------- |
| Username          | `qa` + run token + serial (13 characters, limit 20); exact-length variants padded   |
| Password          | random (credentials must be unpredictable), registered for redaction                |
| SSN               | never-issued 000 area, from a **persistent cursor per environment** (`.test-data/`) |
| First / last name | `Test<tag>` / `Synthetic<tag>`, letters only, unique per customer                   |
| Street, city      | `<serial> Example <tag> Street`, `Testville <tag>`                                  |
| State             | rotated over the 50 valid codes (a closed set cannot be unique per scenario)        |
| ZIP               | `00000-<serial>` (ZIP 00000 is never issued; ZIP+4 unique within the run)           |
| Phone             | reserved fictional `555-01xx` with a unique extension                               |
| Payee             | own name, address, phone and account number per payment                             |
| Contact update    | own new address and phone, distinct from every customer's                           |

Lengths respect ParaBank's schema (names 30, address 45, city/state/zip/phone 20, SSN 15,
username/password 20); longer input fails registration (PB-17).

**SSN collisions.** ParaBank's login recovery fails for every customer sharing an SSN (PB-15), and
the 000 area holds only 10^6 values. The cursor file (`.test-data/ssn-cursor-<env>.json`,
git-ignored, holds a counter, not an SSN) makes successive runs against the same long-lived QA or
UAT database continue the sequence instead of drawing again: a suite customer's SSN is not reused
until 10^6 customers later. Without a cursor (first run, fresh CI workspace, which always comes with
a freshly deployed database) the sequence starts at a random point. Remaining risk: customers
created before the cursor existed, or by other means, on a database that was never redeployed.

## Scenario inputs (feature files)

Business inputs were made scenario-specific where the exact value does not matter (transfer
128.45, loan 240 / 24, funds-too-low down payment 12, transaction amounts 41.15 / 44.85 / 46.30 /
52.60, invalid inputs `ten`, `xyz`, `lots`, `txn`, date `10.06.2026`; bill-pay filler amounts
18.30 / 23.70 / 27.90). Every remaining repetition is registered, with its reason, in
`scripts/audit-test-data.ts` and fails the audit if it is not:

| Value             | Scenarios                            | Why it is repeated                                                        |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `""` (empty)      | transfer rejected, PB-09, PB-10 ×2   | the empty-input partition; comparison pair; documented PB-10 reproduction |
| `abc`             | transfer rejected, PB-09             | comparison pair (same input, different oracle); documented PB-09 value    |
| 1.00 down payment | 5× funds approved, PB-11             | minimal pair: only the loan amount differs (by one cent)                  |
| 160.00 loan       | down payment = funds, = funds + 0.01 | minimal pair: only the down payment differs (by one cent)                 |
| 100.00 loan       | PB-06, PB-10                         | documented PB-06 reproduction; PB-10 companion value                      |
| -5.00             | PB-04, PB-05                         | documented reproduction value                                             |
| 0.00              | PB-07 ×2                             | zero boundary, two endpoints                                              |
| 0.001             | PB-08 ×2                             | sub-cent boundary, two endpoints                                          |

Not repetitions of test data: the 100.00 opening deposit and 515.50 opening balance (ParaBank's
rules), `Renamed` and the PB-12 "other person" (single scenario), SSN `999-00-0000` and transaction
ID `999999999` (deliberately non-existent identifiers, single scenario), and the PB-02 probe amount
1.00 (one known-defect outline, same proof for three endpoints).

## Evidence

- `npm run audit:test-data`: static audit of every scenario's Given/When inputs (77 scenarios).
  Before: 44 input uses, 18 distinct values, 10 repeated (`100.00` ×6, `abc` ×6, `37.25` ×5, …).
  After: 44 uses, 32 distinct, 8 repeated, all classified.
- `TEST_DATA_AUDIT=true` (any run): writes `<reports>/test-data-audit.json`, the generated values
  per category and scenario as HMAC fingerprints under a key that exists only in memory (no
  values, not reversible). Before: first name, last name, city, state and ZIP one value for every
  customer; phone numbers collided across scenarios. After: every category unique per scenario,
  except state (50 valid codes) and the values a scenario provides on purpose (the taken username,
  PB-15's duplicate SSN, PB-16's blank names, PB-12's other person).

*  temporary list item with a formatting violation (CI negative test, never merged)
