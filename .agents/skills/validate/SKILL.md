---
name: validate
description: Run the AGENTS.md "Mandatory validation before handing over" sequence in order and report the real result of every command. Never runs the Sanity suite.
disable-model-invocation: true
---

# Validate before handing over

Run the mandatory validation from [AGENTS.md](../../../AGENTS.md) and report what actually ran.
Arguments (optional): `static` runs only steps 1-3; `known-defects` adds step 5; `evidence` adds
step 6.

## Hard rules

- **Never run Sanity** (`npm run test:sanity`, `--profile sanity`, `--grep @sanity`). Sanity is
  manual only. The `ci:coverage --suite sanity --expect 10` inventory count is allowed: it reads
  tags and runs no scenario.
- Never run `npm run uat:deploy`, `env -- deploy uat`, `qa:deploy`, retries or extra workers.
- Do not change code, tags or totals to make a step pass. A failure is reported, then triaged with
  [docs/failure-triage.md](../../../docs/failure-triage.md).
- Keep going after a failure (each step is independent) and report every result.
- Never print credentials, SSNs, session ids, cookies or API bodies from any output.

## Steps

1. Static gates, one at a time:
   `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:dry-run`,
   `npm run audit:test-data`, `npm run test:ci`.
2. Structure and inventories (approved totals; never edit them here):
   `npm run ci:bdd -- --total 77 --known-defects 25`, then
   `npm run ci:coverage -- --suite smoke --expect 4`, `... --suite regression --expect 24`,
   `... --suite sanity --expect 10`, `... --suite full --expect 52`.
3. If the argument is `static`, stop here.
4. Live QA: run `npm run qa:health`. If QA is down, report "QA unavailable: live steps not run"
   and suggest `npm run qa:start` (Docker Desktop may need a manual start after a reboot). Do not
   start it yourself. If healthy: `npm run check:target`, `npm run test:smoke`,
   `npm run test:regression`.
5. With `known-defects`: `npm run test:known-defects` (expected result: every PB-xx "reproduced";
   "no longer reproduces" or "did not fail through the proof" is a finding).
6. With `evidence`: `npm run ci:evidence-scan -- reports`.

## Report

A table: command | result (PASS / FAIL / NOT RUN and why) | key line of output (counts, first
error). Then one line: "Ready for handover" only if every step that ran passed and none was skipped
without a reason the user accepted. A test that did not run did not pass.
