# ParaBank product defects

Found during the functional coverage audit of 2026-10-06 on the controlled DEV environment
(`parabank-local:13cc8d4c0b97`, source commit `13cc8d4c0b978d8da261cad8f2d39b5ed5c0a05b`, image ID
`sha256:73e7e2775a1c…`), with synthetic customers created for each check. Every defect was observed
on DEV and, where useful, traced to the pinned ParaBank source. The public ParaBank site was not
used.

Evidence never contains credentials, SSNs, usernames, session ids or customer data: reproduction
steps say "a synthetic customer" instead. Account numbers and balances shown in automated evidence
belong to throwaway synthetic customers.

## How defects are automated

A scenario tagged `@known-defect @PB-xx` states the **correct** behavior. Its assertions are never
relaxed to match the defect. It is excluded from every gating suite (smoke, sanity, regression,
full; `npx playwright test` runs the 52 normal scenarios only), and the 25 known-defect scenarios
run on their own (`npm run test:known-defects`). Each one is judged as follows:

| Runner                                    | Defect reproduces                                   | Defect fixed                                                         |
| ----------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| `npm run test:known-defects`              | Expected failure (reported, run stays green)        | **Fails**: "PB-xx no longer reproduces": remove the tag and classify |
| `npx cucumber-js --profile known-defects` | Scenario fails (this profile is expected to be red) | Scenario passes                                                      |

A known-defect scenario counts as **reproduced** only when its registered proof fails: every step
before it passed, the first failure is a `Then` step, and it is a failed assertion of the named
outcome check registered for that PB-xx (`playwright/known-defect-proofs.ts`,
`src/support/outcome-check.ts`). Everything else is reported as **not the defect** and fails the
run: a `Given`/setup or `When`/action failure, a navigation, transport or network failure, an
unrelated timeout, a hook failure, an undefined, pending or ambiguous step, an assertion outside a
named outcome check, or a different outcome check than the one that proves this defect. If every
step passes, the run reports that the defect **no longer reproduces**.

Severity: **Critical** = money or identity of other customers at risk; **High** = money created,
lost or made unreadable, or an account takeover path; **Medium** = wrong business decision or
broken flow without data loss; **Low** = misleading feedback or data-quality issue.
Priority: P1 fix before release, P2 next release, P3 backlog.

## Summary

Defects and scenarios are counted separately: one defect ID can be reproduced by several scenarios.

| Metric                                                          | Count | IDs / note                                 |
| --------------------------------------------------------------- | ----: | ------------------------------------------ |
| Documented defect IDs                                           |    20 | PB-01 to PB-20                             |
| Defect IDs with automated reproduction                          |    16 | PB-01 to PB-12, PB-14 to PB-17             |
| Documentation-only defect IDs                                   |     4 | PB-13, PB-18, PB-19, PB-20                 |
| `@known-defect` scenarios (scenario reproductions)              |    25 | `npm run test:known-defects`               |
| Critical defect IDs                                             |     4 | PB-01, PB-02, PB-03, PB-12                 |
| `@known-defect` scenarios reproducing a Critical defect ID      |     8 | PB-01 (3), PB-02 (3), PB-03 (1), PB-12 (1) |
| `@known-defect` scenarios tagged `@p0` (test risk priority tag) |    11 | a scenario tag, not a defect severity      |

Severity revised by the Senior QA audit of 2026-10-07: PB-04 High → Medium, PB-14 Medium → Low.
Priorities are unchanged.

| ID    | Title                                                                                 | Feature                           | Severity | Priority | Automated by                                        |
| ----- | ------------------------------------------------------------------------------------- | --------------------------------- | -------- | -------- | --------------------------------------------------- |
| PB-01 | Any signed-in customer can read another customer's accounts, profile and transactions | Authorization (all services)      | Critical | P1       | `authorization/customer-data-isolation.feature` (3) |
| PB-02 | Any signed-in customer can move money out of another customer's account               | Transfer, Bill Pay, Open Account  | Critical | P1       | `authorization/customer-data-isolation.feature` (3) |
| PB-03 | Any signed-in customer can change another customer's profile and credentials          | Update Contact Info               | Critical | P1       | `authorization/customer-data-isolation.feature` (1) |
| PB-04 | A negative transfer moves money in reverse                                            | Transfer Funds                    | Medium   | P1       | `transfers/transfer-funds.feature`                  |
| PB-05 | A negative bill payment credits the paying account                                    | Bill Pay                          | High     | P1       | `payments/bill-pay.feature`                         |
| PB-06 | A negative loan down payment is approved and credits the funding account              | Request Loan                      | High     | P1       | `loans/request-loan.feature`                        |
| PB-07 | Zero-amount transfers and bill payments are accepted and posted                       | Transfer Funds, Bill Pay          | Low      | P3       | `transfers/…`, `payments/…`                         |
| PB-08 | Sub-cent amounts are accepted and make the customer's accounts unreadable             | Transfer Funds, Bill Pay          | High     | P1       | `transfers/…`, `payments/…`                         |
| PB-09 | Transfer amount validation messages are never shown                                   | Transfer Funds                    | Low      | P3       | `transfers/transfer-funds.feature` (2)              |
| PB-10 | Loan request input errors show an internal error instead of the defined messages      | Request Loan                      | Low      | P3       | `loans/request-loan.feature` (2)                    |
| PB-11 | The loan funds rule approves loans below the 20% threshold (rounding)                 | Request Loan                      | Medium   | P2       | `loans/request-loan.feature`                        |
| PB-12 | Login recovery identifies the customer by SSN alone and signs the visitor in          | Login Recovery                    | Critical | P1       | `authentication/login-recovery.feature`             |
| PB-13 | Login recovery displays the customer's password                                       | Login Recovery                    | High     | P1       | Not automated (see below)                           |
| PB-14 | Protected pages answer HTTP 500 to signed-out visitors instead of the sign-in prompt  | Log Out / session                 | Low      | P2       | `authentication/sign-in.feature`                    |
| PB-15 | Registration accepts an SSN that already belongs to a customer                        | Registration                      | Medium   | P2       | `registration/registration.feature`                 |
| PB-16 | Names made only of spaces are accepted                                                | Registration, Update Contact Info | Low      | P3       | `registration/…`, `profile/…`                       |
| PB-17 | Over-long registration input is refused as "This username already exists."            | Registration                      | Low      | P3       | `registration/registration.feature`                 |
| PB-18 | The customer's password is embedded in the Update Profile page and request URL        | Update Contact Info               | High     | P1       | Not automated (see below)                           |
| PB-19 | The application log contains credentials and identity data                            | Platform                          | High     | P1       | Not automated (see below)                           |
| PB-20 | Registration is not safe under concurrency                                            | Registration                      | High     | P2       | Not automated (see below)                           |

## Details

### PB-01: Any signed-in customer can read another customer's data

- **Preconditions:** two synthetic customers, A and B, each signed in in their own session.
- **Steps:** from B's session, request A's data through the endpoints ParaBank's own pages call:
  `GET services_proxy/bank/customers/{A's id}/accounts`, `…/customers/{A's id}`,
  `…/accounts/{A's account}/transactions`. The same data is reachable in the UI at
  `activity.htm?id={A's account}` and through Find Transactions by ID (which searches globally).
- **Actual:** HTTP 200 with A's accounts, profile (including the SSN) and transactions.
- **Expected:** the bank refuses (401, 403 or 404) data that does not belong to the signed-in customer.
- **Root cause (source):** `RestServiceProxyController.authenticate()` only checks that a session
  holds _some_ customer; no endpoint compares the requested ids with that customer.
- **Impact:** confidentiality breach of every customer's financial and identity data.
- **Reproducibility:** always (3/3 automated checks).

### PB-02: Any signed-in customer can move money out of another customer's account

- **Steps:** from B's session, with A's account number: transfer to B's account, pay a bill, or
  open a new account for B funded from A's account.
- **Actual:** HTTP 200; A's account is debited (and B's credited, for the transfer and the new
  account). A's persisted ledger changes.
- **Expected:** refused; A's accounts unchanged.
- **Root cause:** same as PB-01 (`transfer`, `billpay`, `createAccount` never check ownership).
- **Impact:** theft of funds between customers. **Reproducibility:** always (3/3).

### PB-03: Any signed-in customer can change another customer's profile

- **Steps:** from B's session, send the profile update for A's customer id (as the Update Profile
  page does) with a different first name.
- **Actual:** HTTP 200; A's stored profile changes. The same request also carries and overwrites
  the username and password, so this is an account-takeover path.
- **Expected:** refused; A's profile unchanged. **Reproducibility:** always.

### PB-04: A negative transfer moves money in reverse

- **Steps:** a synthetic customer with two accounts transfers `-5.00` from source to destination.
- **Actual:** "Transfer Complete!"; the source balance **increases** by 5.00 and the destination
  decreases by 5.00; two transactions are posted.
- **Expected:** rejected; no balance or transaction changes.
- **Root cause:** no client-side validation on Transfer Funds and no amount check in
  `BankManagerImpl.transfer()`. **Reproducibility:** always.

### PB-05: A negative bill payment credits the paying account

- **Steps:** pay `-5.00` to a payee. The page's check (`parseFloat` is a number) accepts it.
- **Actual:** "Bill Payment Complete"; the account balance increases by 5.00.
- **Expected:** rejected; no change. **Reproducibility:** always.

### PB-06: A negative loan down payment is approved and credits the funding account

- **Steps:** request a 100.00 loan with a `-10.00` down payment.
- **Actual:** approved; a LOAN account is opened and the funding account balance **increases** by
  10.00.
- **Expected:** refused; no account opened, no money moved.
- **Root cause:** `AbstractLoanProcessor` only rejects a down payment _above_ the available funds.

### PB-07: Zero-amount transfers and bill payments are accepted and posted

- **Actual:** confirmation shown; $0.00 transactions are posted (two for a transfer, one for a bill
  payment). Balances unchanged.
- **Expected:** rejected, nothing posted. Low severity: no money moves, but the ledger is polluted.

### PB-08: Sub-cent amounts are accepted and make the customer's accounts unreadable

- **Steps:** transfer or pay `0.001`.
- **Actual:** HTTP 200 and a confirmation. Amounts are stored as `DECIMAL(19,4)`, and from then on
  `GET services_proxy/bank/customers/{id}/accounts` answers **HTTP 500** for that customer: the
  Accounts Overview is permanently broken.
- **Expected:** amounts with more than two decimals rejected.
- **Note:** the same symptom was observed earlier on the public site after a third party set
  sub-cent opening balances (docs/qa-coverage.md).

### PB-09: Transfer amount validation messages are never shown

- **Steps:** submit Transfer Funds with an empty amount, or with `abc`.
- **Actual:** "Error! An internal error has occurred and has been logged." (server HTTP 400). No
  money moves.
- **Expected:** "The amount cannot be empty." / "Please enter a valid amount.": both messages are
  defined in the page (`transfer.jsp`) but no code ever displays them.

### PB-10: Loan request input errors show an internal error

- **Steps:** apply for a loan with an empty amount, or an empty down payment.
- **Actual:** the generic error panel (server HTTP 400).
- **Expected:** "The loan amount cannot be empty." / "The down payment cannot be empty." (defined in
  `messages.properties`, never used by the page).
- **Also observed (not automated, no defined message):** a loan amount of `0` makes the server
  divide by zero (HTTP 500).

### PB-11: The loan funds rule approves loans below the 20% threshold

- **Configuration:** loan processor "Available Funds", threshold 20 (seed defaults).
- **Steps:** a customer whose available funds are F requests a loan of `5 × F + 0.01`.
- **Actual:** approved. With F = 515.50, every amount up to 2583.95 is approved (funds = 19.95% of
  the amount); 2583.96 is the first denial.
- **Expected:** denied with "We cannot grant a loan in that amount with your available funds."
- **Root cause:** `AvailableFundsLoanProcessor` rounds `funds / amount` to 3 decimals (HALF_UP)
  before comparing it with 0.20.

### PB-12: Login recovery identifies the customer by SSN alone

- **Steps:** as a visitor, open "Forgot login info?", enter a registered synthetic customer's SSN
  with a different name and address.
- **Actual:** "Your login information was located successfully. You are now logged in."; the
  page displays that customer's username and password, and the visitor's session is signed in as
  that customer (their accounts endpoint answers 200).
- **Expected:** "The customer information provided could not be found."; not signed in.
- **Root cause:** `CustomerLookupController` validates that all fields are present but looks the
  customer up with `getCustomer(ssn)` only.
- **Impact:** account takeover with one identity number. **Reproducibility:** always.

### PB-13: Login recovery displays the customer's password

- A successful recovery prints the username and the plaintext password on the page
  (`lookupConfirm.jsp`). Passwords are stored recoverably.
- **Not automated:** asserting it would require reading the password from the page into evidence.
  The successful-recovery scenario checks the username in memory only, and failure screenshots
  mask that panel.

### PB-14: Protected pages answer HTTP 500 to signed-out visitors

- **Steps:** sign out (or never sign in), then open `overview.htm` (also `transfer.htm`,
  `billpay.htm`, `findtrans.htm`, `updateprofile.htm`, `requestloan.htm`, `openaccount.htm`).
- **Actual:** HTTP 500, "An internal error has occurred and has been logged."
  (`activity.htm` answers 200 with the same error.)
- **Expected:** the sign-in prompt "You must be logged in to use this feature.": this is what
  `LoginInterceptor` is written to show (view `loginform`). The session itself is correctly
  ended (the accounts endpoint answers 401).

### PB-15: Registration accepts an SSN that already belongs to a customer

- **Actual:** the second registration succeeds. Afterwards, login recovery with that SSN fails with
  an error for **both** customers (the lookup expects one customer per SSN).
- **Expected:** registration refused. No message is defined by the product; the scenario asserts
  that registration is not confirmed and the visitor is not signed in.

### PB-16: Names made only of spaces are accepted

- **Registration:** first and last name of spaces are accepted (`ValidationUtils.rejectIfEmpty`
  instead of `rejectIfEmptyOrWhitespace`). **Update Contact Info:** the page's check accepts any
  non-empty value, so a first name of spaces is stored. Bill Pay, by contrast, trims and refuses.
- **Expected:** "First name is required." / "Last name is required."; nothing stored.

### PB-17: Over-long registration input is refused as "This username already exists."

- **Boundary (schema):** username and password 20 characters, names 30, SSN 15. A 20-character
  username or password is accepted; 21 characters (or a 31-character first name, or a 16-character
  SSN) is refused with "This username already exists.", because every database error is reported
  as a duplicate username. On Update Contact Info a 31-character first name gives HTTP 500.
- **Expected:** a message about the field that is too long. The product defines none, so the
  scenario asserts the visitor is not signed in and is not told the username exists.

### PB-18: The customer's password is embedded in the Update Profile page and request URL

- The page script contains the password, and the update request sends it in the query string, where
  proxies, server access logs, browser history and test traces record it. Documented earlier as a
  security finding; it drives this project's trace policy.
- **Not automated:** proving it means capturing the password.

### PB-19: The application log contains credentials and identity data

- Every sign-in logs the username and plaintext password; customer objects are logged with password
  and SSN. CI therefore archives only redacted container logs (`scripts/ci/environment.ts`).
- **Not automated:** it concerns server logs, not product behavior a customer sees.

### PB-20: Registration is not safe under concurrency

- With simultaneous registrations, some are silently not created, and one confirmed session was
  bound to a different customer (docs/qa-coverage.md). The suite therefore runs with one worker.
- **Not automated:** reproducing it needs parallel load, which this project forbids on DEV.

## Ambiguous requirements (not encoded as defects)

| ID    | Observation                                                                                                                  | Why it is not a defect yet                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AR-01 | Transfers, bill payments and the opening deposit may overdraw an account without limit                                       | ParaBank shows an "Available Amount" of 0 for negative balances, which suggests overdrafts exist by design; no limit is specified |
| AR-02 | A transfer to the same account is accepted (two postings, no net change); the form preselects the same account in both lists | No rule states that the accounts must differ                                                                                      |
| AR-03 | The loan down payment is checked against the customer's total funds, not the funding account, which can be overdrawn by it   | Depends on AR-01                                                                                                                  |
| AR-04 | `admin.htm` (database initialize/clean, balances, loan settings) is public                                                   | Deliberate in the ParaBank demo distribution. Critical in a real bank; never exercised by this suite (destructive)                |
| AR-05 | Usernames are case-sensitive and not trimmed at sign-in                                                                      | Acceptable behavior; no rule says otherwise                                                                                       |
| AR-06 | A negative loan amount is denied with "…with your available funds."                                                          | The request is refused (no money moves), only the reason is imprecise                                                             |

## Other findings

- **Test defect (fixed in this audit):** none of the 27 original scenarios was wrong, but two were
  weaker than the product allows: "transfer without an amount" asserted only the generic error
  panel (now an outline with the non-numeric partition plus PB-09 for the intended messages), and
  the down-payment example was titled "exceeds the funding account balance" although the product
  checks total funds (title corrected, assertion unchanged).
- **Environment issue:** the 27 failures before this audit were the DEV container stopped by a host
  reboot (Docker Desktop is not started automatically; `restart: 'no'`).
- **Unreachable through the UI:** a transfer to a nonexistent account (API only) answers HTTP 500
  and moves no money; an account type outside CHECKING/SAVINGS can be created through the API
  (`newAccountType=2` creates a LOAN account). Not part of the customer-facing product, not
  automated.
