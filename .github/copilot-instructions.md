# Copilot instructions

The authoritative rules for every AI agent in this repository are in [AGENTS.md](../AGENTS.md);
read and follow it. This file only repeats the non-negotiables for surfaces that do not load
`AGENTS.md` (Copilot Chat on github.com reads this file).

- Tests are Gherkin scenarios in `features/` run by Cucumber; never write `*.spec.ts` files or
  Playwright `test()` blocks for behavior. Steps coordinate, Page Objects hold locators, data comes
  from `src/factories`.
- One worker and no retries, everywhere (enforced by `cucumber.js` and
  `playwright/global-setup.ts`). Never weaken an assertion to get a green run.
- Approved suite sizes: Smoke 4, Sanity 10, Regression 24, Full 52, known defects 25 (77 total).
  Sanity is manual only. Known-defect scenarios keep their registered proofs.
- Never put passwords, usernames, SSNs, session ids, cookies or tokens in logs, reports,
  screenshots, traces, docs or suggestions.
- Never merge a pull request or answer the Jenkins UAT approval: both are human acts. Never change
  Jenkins, Docker or GitHub protections to make tests pass.
