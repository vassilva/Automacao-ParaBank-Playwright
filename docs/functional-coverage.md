# Functional coverage: ParaBank (audit of 2026-10-06)

Target: the controlled environment on port 8090 (DEV at the time, now QA; `http://localhost:8090/parabank/`, source-built image
`parabank-local:13cc8d4c0b97`, seed configuration: opening balance 515.50, minimum deposit 100.00,
loan processor "Available Funds", threshold 20%). Rules were discovered on DEV and in the pinned
ParaBank source (validators, controllers, JSP scripts, `messages.properties`, schema), never assumed.
Product defects are in [defects.md](defects.md); suites in [test-suites.md](test-suites.md).

## Inventory

| Scenarios            | Before | After (v1) | Baseline v2 | Notes                                                                 |
| -------------------- | -----: | ---------: | ----------: | --------------------------------------------------------------------- |
| Gating (full suite)  |     27 |         54 |          52 | all pass; v2 removed two duplicates (scenario-inventory.md)           |
| Known defects        |      0 |         25 |          25 | state the correct behavior; reproduce 16 product defects (defects.md) |
| **Behavioral total** | **27** |     **79** |      **77** | one Gherkin source; both runners execute exactly these scenarios      |

Two of the original 27 were turned into Scenario Outlines with one more partition each (their
original rows keep their names' meaning and classification); none was removed.

Status values: **COVERED** (existed and still passes), **NEW** (added, passes), **DEFECT** (added,
states the correct behavior, reproduces a product defect), **NOT SUPPORTED** / **NOT APPLICABLE** /
**BLOCKED** (not automated, reason given).

Oracles: **Ledger** = persisted before/after state of every account (types, balances in integer
cents, every transaction) compared with the expected state the test computes from the BEFORE state
and the known input; **No-op** = complete before/after ledger equality; **API** = persisted record
read independently of the page; **No request** = the browser sent no state-changing request.

## Traceability matrix

### Open New Account

| Business rule                                                        | Type          | Risk | Scenario                                                                                            | Expected result / error                                                      | Oracle                                                           | Suite              | Status                          |
| -------------------------------------------------------------------- | ------------- | ---- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------ | ------------------------------- |
| A SAVINGS account can be opened, funded with the minimum deposit     | POSITIVE      | P0   | accounts.feature: Open a new SAVINGS account (outline)                                              | "Account Opened!", new account number                                        | Ledger: new SAVINGS = 100.00, funding −100.00, one transfer pair | sanity, regression | COVERED                         |
| A CHECKING account can be opened likewise                            | POSITIVE      | P1   | accounts.feature: Open a new CHECKING account (outline)                                             | same                                                                         | same                                                             | regression         | COVERED                         |
| Only CHECKING and SAVINGS are offered; the minimum deposit is stated | STATE         | P2   | accounts.feature: Only checking and savings accounts can be opened online                           | types exactly [CHECKING, SAVINGS]; "A minimum of $100.00 must be deposited…" | page                                                             | full               | NEW                             |
| A new account is usable (receives money, shown in the overview)      | STATE         | P1   | accounts.feature overview + every transfer scenario (they use an API-opened account as destination) | listed with its balance; receives transfers                                  | Ledger                                                           | smoke / regression | COVERED                         |
| An account cannot be funded from another customer's account          | AUTHORIZATION | P0   | customer-data-isolation.feature: … with a new account                                               | refused (401/403/404)                                                        | No-op on the other customer's ledger                             | known defect       | DEFECT (PB-02)                  |
| Funding account with less than the minimum deposit                   | NEGATIVE      | —    | —                                                                                                   | accepted, account overdrawn                                                  | —                                                                | —                  | NOT APPLICABLE (AR-01, no rule) |

### Accounts Overview and account details

| Business rule                                                                                | Type          | Risk | Scenario                                                                   | Expected result / error                           | Oracle                                                | Suite             | Status                                     |
| -------------------------------------------------------------------------------------------- | ------------- | ---- | -------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- | ----------------- | ------------------------------------------ |
| Every account is listed with its balance and available amount; total = sum                   | POSITIVE      | P0   | accounts.feature: The accounts overview matches the bank's records         | rows and total equal the independent model        | Model (opening − deposit, deposit) vs page AND vs API | smoke, regression | COVERED                                    |
| An account's details page shows number, type, balance, available amount and its transactions | POSITIVE      | P1   | accounts.feature: An account's details page matches the bank's records     | equal to the model and the persisted transactions | Model + API                                           | regression        | NEW                                        |
| A new customer owns exactly one funded account                                               | STATE         | P0   | registration.feature: A new customer registers…                            | one account, positive balance                     | API                                                   | smoke             | COVERED                                    |
| Available amount is 0 for a negative balance                                                 | BOUNDARY      | —    | —                                                                          | —                                                 | —                                                     | —                 | NOT APPLICABLE (needs an overdraft, AR-01) |
| Another customer's accounts are not readable                                                 | AUTHORIZATION | P0   | customer-data-isolation.feature: I cannot read another customer's accounts | refused                                           | HTTP status                                           | known defect      | DEFECT (PB-01)                             |

### Transfer Funds

| Business rule                                              | Type          | Risk | Scenario                                                         | Expected result / error                                        | Oracle                                                            | Suite                     | Status                        |
| ---------------------------------------------------------- | ------------- | ---- | ---------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------- | ----------------------------- |
| A transfer moves the exact amount between two own accounts | POSITIVE      | P0   | transfer-funds.feature: Transfer funds… (100.00)                 | "Transfer Complete!" with amount and accounts                  | Ledger: −amount / +amount, one debit and one credit, nothing else | smoke, sanity, regression | COVERED                       |
| The smallest currency unit is transferred exactly          | BOUNDARY      | P1   | Transfer funds… (0.01)                                           | same                                                           | Ledger                                                            | regression                | COVERED                       |
| A transfer without an amount is rejected                   | NEGATIVE      | P1   | A transfer with no amount is rejected and moves no money         | not confirmed (error panel)                                    | No-op                                                             | regression                | COVERED                       |
| A non-numeric amount is rejected                           | NEGATIVE      | P2   | A transfer with an amount that is not a number…                  | not confirmed                                                  | No-op                                                             | full                      | NEW                           |
| The customer is told why the amount is invalid             | NEGATIVE      | P2   | The customer is told why a transfer amount is invalid (2)        | "The amount cannot be empty." / "Please enter a valid amount." | No-op                                                             | known defect              | DEFECT (PB-09)                |
| A negative amount is rejected                              | NEGATIVE      | P0   | A transfer of a negative amount…                                 | rejected                                                       | No-op (fails: money moves in reverse)                             | known defect              | DEFECT (PB-04)                |
| A zero amount is rejected                                  | BOUNDARY      | P2   | A transfer of a zero amount…                                     | rejected                                                       | No-op (fails: $0 postings)                                        | known defect              | DEFECT (PB-07)                |
| More than two decimals are rejected                        | BOUNDARY      | P1   | A transfer of a fraction of a cent…                              | rejected                                                       | No-op (fails: accounts unreadable, HTTP 500)                      | known defect              | DEFECT (PB-08)                |
| Money cannot leave another customer's account              | AUTHORIZATION | P0   | customer-data-isolation.feature: … with a transfer to my account | refused                                                        | No-op on the other ledger                                         | known defect              | DEFECT (PB-02)                |
| Amount above the balance; same source and destination      | NEGATIVE      | —    | —                                                                | accepted                                                       | —                                                                 | —                         | NOT APPLICABLE (AR-01, AR-02) |

### Bill Pay

| Business rule                                           | Type               | Risk     | Scenario                                                               | Expected result / error                                  | Oracle                                               | Suite              | Status                       |
| ------------------------------------------------------- | ------------------ | -------- | ---------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- | ------------------ | ---------------------------- |
| A payment debits the exact amount and records the payee | POSITIVE           | P0       | bill-pay.feature: Pay a bill to a payee                                | "Bill Payment Complete" with payee, amount, account      | Ledger: −amount, one debit "Bill Payment to {payee}" | sanity, regression | COVERED                      |
| The account number must be confirmed identically        | NEGATIVE           | P1       | A bill payment is not sent when the payee account numbers do not match | "The account numbers do not match."                      | No request + No-op                                   | regression         | COVERED                      |
| Every payee detail and the amount are mandatory         | NEGATIVE           | P2       | A bill payment lists every mandatory payee detail when submitted empty | 8 messages                                               | No request                                           | full               | COVERED                      |
| The amount must be a number                             | NEGATIVE           | P2       | A bill payment with an invalid amount…                                 | "Please enter a valid amount." (only that field)         | No request                                           | full               | NEW                          |
| The payee account number must be a number               | NEGATIVE           | P2       | A bill payment with an invalid payee account number…                   | "Please enter a valid number." (number and confirmation) | No request                                           | full               | NEW                          |
| A payee name of spaces counts as missing                | NEGATIVE           | P2       | A payee name made only of spaces is treated as missing                 | "Payee name is required."                                | No request                                           | full               | NEW                          |
| Negative / zero / sub-cent amounts are rejected         | NEGATIVE, BOUNDARY | P0/P2/P1 | A bill payment of a negative / zero / fraction-of-a-cent amount…       | rejected                                                 | No-op                                                | known defect       | DEFECT (PB-05, PB-07, PB-08) |
| Money cannot leave another customer's account           | AUTHORIZATION      | P0       | customer-data-isolation.feature: … with a bill payment                 | refused                                                  | No-op on the other ledger                            | known defect       | DEFECT (PB-02)               |

### Find Transactions

| Business rule                                              | Type               | Risk | Scenario                                                                     | Expected result / error                                              | Oracle                         | Suite              | Status                     |
| ---------------------------------------------------------- | ------------------ | ---- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------ | ------------------ | -------------------------- |
| Search by amount finds the exact transaction               | POSITIVE           | P1   | Find a transaction by its amount                                             | exactly the transfer's debit                                         | Transaction id from the ledger | sanity, regression | COVERED                    |
| Search by transaction ID                                   | POSITIVE           | P2   | Find a transaction by its transaction ID (outline)                           | exactly that transaction                                             | API (persisted transactions)   | full               | NEW                        |
| Search by date (server day, MM-dd-yyyy)                    | POSITIVE           | P2   | Find a transaction by its date                                               | all of that day's transactions of the account                        | API                            | full               | NEW                        |
| Search by date range (inclusive)                           | POSITIVE, BOUNDARY | P2   | Find a transaction by its date range (from = to = day)                       | same as by date                                                      | API                            | full               | NEW                        |
| An amount shared by several transactions lists all of them | POSITIVE           | P2   | A search by amount lists every transaction with that amount                  | both transfers                                                       | Ids from the ledger            | full               | NEW                        |
| No match gives an empty result, not an error               | NEGATIVE           | P2   | A search that matches nothing shows an empty result (amount, nonexistent ID) | empty results table                                                  | page                           | full               | NEW                        |
| Invalid criteria are refused in the browser                | NEGATIVE           | P2   | A search with an invalid amount / transaction ID / date / date range         | "Invalid amount", "Invalid transaction ID", "Invalid date format" ×2 | No results shown               | full               | COVERED (amount) + NEW (3) |
| Another customer's transactions are not searchable         | AUTHORIZATION      | P0   | customer-data-isolation.feature: … account transactions                      | refused                                                              | HTTP status                    | known defect       | DEFECT (PB-01)             |

### Update Contact Info

| Business rule                                                        | Type          | Risk | Scenario                                                                    | Expected result / error          | Oracle                                             | Suite              | Status                                                    |
| -------------------------------------------------------------------- | ------------- | ---- | --------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------- | ------------------ | --------------------------------------------------------- |
| Address and phone changes are persisted; name and identity unchanged | POSITIVE      | P1   | Updated contact details are saved to my customer profile                    | "Profile Updated"                | API: stored profile; SSN compared without printing | sanity, regression | COVERED                                                   |
| First name is required                                               | NEGATIVE      | P2   | A profile update requires a first name                                      | "First name is required." (only) | No request + API unchanged                         | full               | COVERED                                                   |
| Every mandatory contact detail is required                           | NEGATIVE      | P2   | A profile update lists every mandatory contact detail when cleared          | 6 messages                       | No request + API unchanged                         | full               | NEW                                                       |
| The phone number is optional                                         | POSITIVE      | P2   | The phone number is optional in my profile                                  | "Profile Updated"                | API: phone empty, everything else unchanged        | full               | NEW                                                       |
| A first name of spaces counts as missing                             | NEGATIVE      | P2   | A first name made only of spaces is treated as missing                      | "First name is required."        | API unchanged                                      | known defect       | DEFECT (PB-16)                                            |
| Another customer's profile cannot be changed                         | AUTHORIZATION | P0   | customer-data-isolation.feature: I cannot change another customer's profile | refused                          | API: other profile unchanged                       | known defect       | DEFECT (PB-03)                                            |
| Over-long field                                                      | BOUNDARY      | —    | —                                                                           | HTTP 500 (no message defined)    | —                                                  | —                  | NOT AUTOMATED (part of PB-17, expected message undefined) |

### Request Loan

| Business rule                                                                          | Type     | Risk | Scenario                                                       | Expected result / error                                                  | Oracle                                            | Suite              | Status                     |
| -------------------------------------------------------------------------------------- | -------- | ---- | -------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- | ------------------ | -------------------------- |
| An affordable loan opens a LOAN account holding the amount and debits the down payment | POSITIVE | P1   | A loan the customer can afford is approved…                    | "Approved", "Congratulations…"                                           | Ledger: new LOAN = amount, one down-payment debit | sanity, regression | COVERED                    |
| Funds below 20% of the amount: denied                                                  | NEGATIVE | P1   | A loan is denied when the customer's funds are too low         | "We cannot grant a loan in that amount with your available funds."       | No-op                                             | regression         | COVERED                    |
| Funds of exactly 20%: approved                                                         | BOUNDARY | P1   | A loan of exactly five times the available funds is approved   | Approved                                                                 | Ledger                                            | regression         | NEW                        |
| Funds one cent below 20%: denied                                                       | BOUNDARY | P2   | A loan one cent above five times the available funds is denied | denied, message above                                                    | No-op                                             | known defect       | DEFECT (PB-11)             |
| Down payment above the available funds: denied                                         | NEGATIVE | P2   | (v2: removed; covered at the boundary by "…one cent above…")   | "You do not have sufficient funds for the given down payment."           | No-op                                             | regression         | COVERED                    |
| Down payment equal to the available funds: approved                                    | BOUNDARY | P2   | A down payment equal to the available funds is accepted        | Approved                                                                 | Ledger                                            | full               | NEW                        |
| Down payment one cent above the available funds: denied                                | BOUNDARY | P2   | A down payment one cent above the available funds is refused   | message above                                                            | No-op                                             | regression         | NEW                        |
| A negative down payment is refused                                                     | NEGATIVE | P0   | A negative down payment is refused and moves no money          | not approved                                                             | No-op (fails: funding account credited)           | known defect       | DEFECT (PB-06)             |
| Empty amount / down payment are explained                                              | NEGATIVE | P2   | The customer is told which loan detail is missing (2)          | "The loan amount cannot be empty." / "The down payment cannot be empty." | No-op                                             | known defect       | DEFECT (PB-10)             |
| Zero loan amount                                                                       | BOUNDARY | —    | —                                                              | HTTP 500 (no message defined)                                            | —                                                 | —                  | NOT AUTOMATED (PB-10 note) |

### Log Out and session

| Business rule                                  | Type  | Risk | Scenario                                                  | Expected result / error                            | Oracle                     | Suite        | Status         |
| ---------------------------------------------- | ----- | ---- | --------------------------------------------------------- | -------------------------------------------------- | -------------------------- | ------------ | -------------- |
| Signing out ends the session                   | STATE | P0   | v2: Smoke sign-in/sign-out + every authenticated scenario | sign-in form offered                               | API: accounts endpoint 401 | regression   | COVERED        |
| A wrong password gives no access               | STATE | P0   | Sign-in is refused when the password is wrong             | "The username and password could not be verified." | API 401                    | regression   | COVERED        |
| After sign-out, a banking page asks to sign in | STATE | P1   | After signing out, a banking page asks me to sign in      | "You must be logged in to use this feature."       | API 401                    | known defect | DEFECT (PB-14) |

### Registration

| Business rule                                               | Type     | Risk | Scenario                                                              | Expected result / error                              | Oracle           | Suite                     | Status         |
| ----------------------------------------------------------- | -------- | ---- | --------------------------------------------------------------------- | ---------------------------------------------------- | ---------------- | ------------------------- | -------------- |
| A visitor registers, is signed in and owns a funded account | POSITIVE | P0   | A new customer registers and starts with a funded account             | "Welcome {username}", success message                | API: one account | smoke, sanity, regression | COVERED        |
| Password confirmation must match                            | NEGATIVE | P1   | Registration is refused when the password confirmation does not match | "Passwords did not match."                           | not signed in    | regression                | COVERED        |
| Usernames are unique                                        | NEGATIVE | P1   | Registration is refused for a username that is already taken          | "This username already exists."                      | not signed in    | regression                | COVERED        |
| Every detail except the phone is mandatory                  | NEGATIVE | P2   | Registration lists every mandatory detail when submitted empty        | 10 messages; phone optional                          | page             | full                      | COVERED        |
| Username of the maximum length (20) is accepted             | BOUNDARY | P2   | A username of the maximum length is accepted                          | registration confirmed                               | page             | full                      | NEW            |
| Username above the maximum is refused for its length        | BOUNDARY | P2   | A username longer than 20 characters is refused for its length        | not signed in, not "already exists"                  | page             | known defect              | DEFECT (PB-17) |
| An SSN belongs to one customer only                         | NEGATIVE | P1   | Registration is refused for an SSN that already belongs to a customer | not confirmed, not signed in                         | page             | known defect              | DEFECT (PB-15) |
| Names of spaces count as missing                            | NEGATIVE | P2   | Names made only of spaces are treated as missing                      | "First name is required." / "Last name is required." | page             | known defect              | DEFECT (PB-16) |

### Sign In

| Business rule                                                | Type     | Risk | Scenario                                               | Expected result / error                            | Oracle        | Suite                     | Status  |
| ------------------------------------------------------------ | -------- | ---- | ------------------------------------------------------ | -------------------------------------------------- | ------------- | ------------------------- | ------- |
| Valid credentials open the customer's own overview           | POSITIVE | P0   | A registered customer signs in with valid credentials  | own account listed, greeting                       | page          | smoke, sanity, regression | COVERED |
| An unknown username gets the same answer as a wrong password | NEGATIVE | P1   | Sign-in with an unknown username gets the same answer… | "The username and password could not be verified." | not signed in | regression                | NEW     |
| Both fields are required                                     | NEGATIVE | P2   | Sign-in requires both a username and a password        | "Please enter a username and password."            | page          | full                      | COVERED |
| A password is required                                       | NEGATIVE | P2   | Sign-in requires a password                            | same message                                       | API 401       | full                      | NEW     |

### Login Recovery

| Business rule                                          | Type          | Risk | Scenario                                                       | Expected result / error                                 | Oracle                               | Suite        | Status         |
| ------------------------------------------------------ | ------------- | ---- | -------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ | ------------ | -------------- |
| Every identity detail is required                      | NEGATIVE      | P2   | Login recovery requires every identity detail                  | 7 messages                                              | page                                 | full         | COVERED        |
| Correct identity details recover the login and sign in | POSITIVE      | P1   | A customer who proves their identity recovers their login…     | "Your login information was located successfully…"      | username compared in memory; API 200 | regression   | NEW            |
| Details matching no customer are refused               | NEGATIVE      | P1   | Login recovery refuses identity details that match no customer | "The customer information provided could not be found." | not signed in                        | regression   | NEW            |
| All details must match, not only the SSN               | AUTHORIZATION | P0   | Login recovery is refused when only the SSN matches            | same message                                            | API: no access                       | known defect | DEFECT (PB-12) |

### Public navigation

| Business rule                                           | Type     | Risk | Scenario                                               | Expected result / error                                                      | Oracle | Suite  | Status                            |
| ------------------------------------------------------- | -------- | ---- | ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------ | ------ | --------------------------------- |
| The home page leads to registration and login recovery  | POSITIVE | P2   | A visitor reaches <destination> from the home page (2) | page reached                                                                 | page   | sanity | COVERED                           |
| Customer care accepts a visitor's message               | POSITIVE | P2   | A visitor's message is accepted by customer care       | "Thank you {name}", "A Customer Care Representative will be contacting you." | page   | full   | NEW                               |
| Customer care requires every contact detail             | NEGATIVE | P2   | Customer care requires every contact detail            | 4 messages                                                                   | page   | full   | NEW                               |
| About Us, Services, Products, Locations, site map, news | —        | —    | —                                                      | static content; Products/Locations leave the site                            | —      | —      | NOT APPLICABLE (no business rule) |
| Admin page                                              | —        | —    | —                                                      | public by design; destructive                                                | —      | —      | BLOCKED (AR-04, never exercised)  |

## Error message inventory

Every message below is part of supported product behavior and has an explicit assertion.

| Feature           | Trigger                           | Message                                                              | Where                     | Scenario (file)                 | State assertion            |
| ----------------- | --------------------------------- | -------------------------------------------------------------------- | ------------------------- | ------------------------------- | -------------------------- |
| Sign in           | wrong password / unknown username | The username and password could not be verified.                     | error page                | sign-in (2)                     | API 401 / not signed in    |
| Sign in           | a field missing                   | Please enter a username and password.                                | error page                | sign-in (2)                     | API 401                    |
| Session           | protected page while signed out   | You must be logged in to use this feature.                           | main panel                | sign-in (PB-14)                 | API 401                    |
| Registration      | each field empty                  | First name … Password confirmation is required. (10 messages)        | under each field          | registration                    | —                          |
| Registration      | confirmation differs              | Passwords did not match.                                             | confirmation field        | registration                    | not signed in              |
| Registration      | username taken                    | This username already exists.                                        | username field            | registration                    | not signed in              |
| Login recovery    | each field empty                  | First name … Social Security Number is required. (7)                 | under each field          | login-recovery                  | —                          |
| Login recovery    | no customer matches               | The customer information provided could not be found.                | error page                | login-recovery (2, one PB-12)   | not signed in / no access  |
| Bill pay          | each field empty                  | Payee name … The amount cannot be empty. (8)                         | under each field          | bill-pay                        | no request                 |
| Bill pay          | confirmation differs              | The account numbers do not match.                                    | confirmation field        | bill-pay                        | no request + no-op         |
| Bill pay          | amount not a number               | Please enter a valid amount.                                         | amount field              | bill-pay                        | no request                 |
| Bill pay          | account number not a number       | Please enter a valid number.                                         | number + confirmation     | bill-pay                        | no request                 |
| Transfer          | empty / not a number              | The amount cannot be empty. / Please enter a valid amount.           | above the form (intended) | transfer-funds (PB-09)          | no-op                      |
| Find transactions | invalid criteria                  | Invalid amount / Invalid transaction ID / Invalid date format        | next to each search       | find-transactions (4)           | no results shown           |
| Profile           | each mandatory field empty        | First name … Zip Code is required. (6)                               | under each field          | update-contact-info (2 + PB-16) | no request + API unchanged |
| Loan              | funds below 20%                   | We cannot grant a loan in that amount with your available funds.     | result panel              | request-loan (1 + PB-11)        | no-op                      |
| Loan              | down payment above funds          | You do not have sufficient funds for the given down payment.         | result panel              | request-loan (2)                | no-op                      |
| Loan              | amount / down payment empty       | The loan amount cannot be empty. / The down payment cannot be empty. | intended                  | request-loan (PB-10)            | no-op                      |
| Customer care     | each field empty                  | Name / Email / Phone / Message is required.                          | under each field          | home                            | —                          |

Defined in `messages.properties` but not reachable from a customer flow (admin, web-service
configuration, account activity month/type): not inventoried. `error.insufficient.down.payment` and
`error.insufficient.funds.and.down.payment` belong to the other loan processors, which are only
selectable on the admin page (BLOCKED, AR-04).

## Discovered boundaries

| Rule                        | Below                  | At                               | Above                                                                            |
| --------------------------- | ---------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| Smallest transfer           | 0.00: accepted (PB-07) | 0.01: exact (COVERED)            | —                                                                                |
| Monetary precision          | —                      | 2 decimals (all money scenarios) | 3 decimals: accepted, breaks the account (PB-08)                                 |
| Loan funds rule (≥ 20%)     | —                      | funds × 5: approved (NEW)        | funds × 5 + 0.01: approved (PB-11); real cut-off 2583.95/2583.96 at funds 515.50 |
| Loan down payment ≤ funds   | —                      | = funds: approved (NEW)          | funds + 0.01: denied (NEW)                                                       |
| Username length (schema 20) | —                      | 20: accepted (NEW)               | 21: wrong message (PB-17)                                                        |
| Date range                  | —                      | from = to = day: inclusive (NEW) | —                                                                                |

## Financial oracles

**Positive (BEFORE + KNOWN INPUT = EXPECTED, compared with PERSISTED AFTER, integer cents):**
transfer 100.00 and 0.01; bill pay 42.10; open SAVINGS and CHECKING; loan approved (100/10, funds × 5,
down payment = funds); overview and account details (independent model).

**No-op (BEFORE + INVALID OPERATION = NO STATE CHANGE, full ledger):** transfer with no amount and
with a non-numeric amount; bill payment with mismatched confirmation; loan denied (funds too low,
down payment too high, down payment one cent too high). Known-defect no-op checks (they fail and
prove the defect): negative/zero/sub-cent transfers and bill payments, negative down payment, PB-09,
PB-10, PB-11, and the other customer's ledger in PB-02.

## Access and session

Covered and passing: session end on sign-out (API 401), wrong password and unknown username (no
access, identical message), signed-in recovery only with the full identity. Reproduced defects:
cross-customer reads (PB-01), money movement (PB-02), profile change (PB-03), SSN-only recovery
(PB-12), HTTP 500 instead of the sign-in prompt (PB-14). All cross-customer checks use two
synthetic customers created by the scenario, never seeded or other data, and are non-destructive
except to those two customers.

## Coverage gaps (not hidden)

- **Overdraft and same-account transfer** (AR-01, AR-02): no requirement; not encoded either way.
- **Account Activity month and type filters:** read-only views of persisted transactions already
  verified through the API; lower risk. Not automated.
- **Transaction details page** (`transaction.htm`): reached from search results; not asserted.
- **Loan processors other than "Available Funds"** and every admin-configurable value: changing
  them requires the admin page (AR-04). The suite runs on the seed configuration.
- **Zero loan amount, over-long profile fields:** product defines no message; documented (PB-10,
  PB-17) but not automated.
- **Password display, password in URL, credential logging, concurrency** (PB-13, PB-18, PB-19,
  PB-20): documented; automating them would put credentials into evidence or need parallel load.
- **Time zone:** date searches assume ParaBank's day equals the server's day (UTC on DEV); the test
  derives the day from the persisted transaction date, robust for server offsets within ±12 h.
- **CI coverage gate:** resolved in Baseline v2: `scripts/ci/verify-suite-coverage.ts` now validates
  each suite against its own approved size (docs/ci-cd.md).

## Artifact classification (sensitive data)

| Artifact                                                                  | Can contain                                                                           | Protection                                                                                                                                                            | Class                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Gherkin, step definitions, page objects, docs                             | no credentials (generated at run time)                                                | code review                                                                                                                                                           | SAFE TO SHARE                                                         |
| Cucumber JSON / HTML / JUnit, Playwright HTML / JUnit                     | step text, Playwright action steps (typed values), failure messages, attachments      | every step/hook error is redacted (`src/support/evidence.ts`), adapter re-redacts; typed values in Playwright steps are replaced (`playwright/redacting-reporter.ts`) | SAFE TO SHARE (synthetic data only; verified by scan)                 |
| Failure screenshots                                                       | page content                                                                          | masked before capture: credential and SSN inputs, the recovered-credentials panel, the registration greeting, any text showing a generated credential or SSN          | SAFE TO SHARE                                                         |
| `error-context.md` (Playwright)                                           | failure message                                                                       | redacted; ARIA page snapshot disabled (`PLAYWRIGHT_NO_COPY_PROMPT`)                                                                                                   | SAFE TO SHARE                                                         |
| `reports/network-diagnostics.jsonl` (`NET_DIAG=true`)                     | method, redacted path, status, safe headers                                           | allow-list, no bodies/cookies                                                                                                                                         | INTERNAL ONLY                                                         |
| Playwright traces (`PW_TRACE_ON_FAILURE=true`, UI Mode)                   | every fill value (passwords), POST bodies, cookies, session ids, DOM with credentials | opt-in; cannot be redacted                                                                                                                                            | DO NOT PERSIST / never publish from CI                                |
| ParaBank container logs                                                   | plaintext usernames, passwords, SSNs (PB-19)                                          | redacted line by line before saving (`scripts/log-redaction.ts`); a line that still looks like a credential is withheld                                               | DO NOT PERSIST unredacted                                             |
| ParaBank image build output (Jenkins console, `build/parabank-build.log`) | the vendor demo customer and sample SSNs printed by ParaBank's own tests              | redacted line by line before it is printed or written (`scripts/log-redaction.ts`)                                                                                    | SAFE TO SHARE once redacted; builds before the fix: see docs/ci-cd.md |
| `.env`                                                                    | local overrides (no credentials needed)                                               | git-ignored                                                                                                                                                           | INTERNAL ONLY                                                         |
