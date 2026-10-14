# Project status: Master Execution Plan checklist (2026-10-14)

State of the Master Execution Plan on 2026-10-14, `main` at `b6cacfa`. Every entry names its
evidence. **Limitation:** the original plan included screenshots that were not available when this
was reconciled; it was reconciled against the written plan, this repository, its PR history and the
Jenkins records, and no requirement was inferred from the screenshots.

The requirement-by-requirement matrix (sources, implementation, tests, evidence) is
[requirements-traceability.md](requirements-traceability.md).

Statuses: COMPLETED (integrated in `main` and verified), READY FOR MERGE (open PR, checks green),
OWNER APPROVAL REQUIRED (prepared and tested in isolation, changes live state), BLOCKED (waits for
an external event), DEFERRED (not justified now, with the reason).

## Pipeline and environments

| Requirement                                                                     | Status            | Evidence                                                                                                   |
| ------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| PR: Quality Gates and QA Smoke (4); no Regression, no UAT; manual merge         | COMPLETED         | Required checks `Jenkins` + `pr-head` (ruleset 24842741); PR builds of #20 to #23                          |
| `main`: QA Regression (24, once), manual UAT Approval, promotion, UAT Smoke (4) | COMPLETED         | `main` #13 to #18 SUCCESS, each approved by the owner ([ci-cd.md](ci-cd.md#validation-status))             |
| Approval refused, timed out, unauthorized or unconfigured: nothing deployed     | COMPLETED         | Pipeline model tests; isolated Jenkins 2.580.1 (2026-10-13)                                                |
| Same image in QA and UAT; reuse when UAT already runs it healthy                | COMPLETED         | `env:identity`; deployment records of `main` #14 to #18 ("not required")                                   |
| Redeploy when UAT runs another image, is absent or unhealthy                    | COMPLETED (model) | The Jenkinsfile's own decision evaluated in `pipeline.test.ts` (#23)                                       |
| A real approved redeployment of a new image under the current Jenkinsfile       | BLOCKED           | Needs a genuine application-image change; never forced artificially. The path ran in `main` #1, #3, #4, #5 |
| Test-only changes never rebuild the application image                           | COMPLETED         | Image decision REUSE in `main` #14 to #18; inputs digest unchanged                                         |
| Global serialization, one build RUNNING                                         | COMPLETED         | Queue plugin live; `build-overlap.ts`: 0 overlapping; `test:queue` on 2.580.1: 105/105 (#22)               |
| One worker, no retries; Sanity and Known Defects manual only                    | COMPLETED         | `cucumber.js`, Playwright global setup, pipeline tests                                                     |

## Tests and quality

| Requirement                                                                  | Status    | Evidence                                                                  |
| ---------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------- |
| Inventory: Smoke 4, Regression 24, Sanity 10, Full 52, Known Defects 25 (77) | COMPLETED | `ci:bdd`, `ci:coverage` on `main` (2026-10-14)                            |
| Coverage gaps reviewed; no scenario added without a real gap                 | COMPLETED | [functional-coverage.md](functional-coverage.md#coverage-gaps-not-hidden) |
| No flaky evidence                                                            | COMPLETED | Every retained Jenkins build: 0 failed scenarios                          |
| Architecture (Cucumber, Page Objects, World, hooks, locators) unchanged      | COMPLETED | Lint layer rules; locator audit (ids/names/roles only)                    |

## Security

| Requirement                                                                  | Status                  | Evidence or prepared change                                                                  |
| ---------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------- |
| Redaction of logs, reports, screenshots; traces never in CI                  | COMPLETED               | README "Security approach"; redaction tests                                                  |
| Evidence scan before JUnit and archive (zip, embedded reports, fail closed)  | COMPLETED               | #20; `main` #15 to #18: scan OK, then lock release, JUnit, archive                           |
| Jenkins 2.580.1 / Java 21, no security warnings                              | COMPLETED               | 0 matching update-center warnings (2026-10-14)                                               |
| Matrix authorization                                                         | OWNER APPROVAL REQUIRED | [security-hardening.md](security-hardening.md), Proposal 1; drill 22/22 incl. rollback (#24) |
| Backups and rollback volumes holding credential-decryption material          | OWNER APPROVAL REQUIRED | Proposal 2: encrypt one copy (procedure drilled), delete plain copies                        |
| Leftover container `festive_elgamal` with the Jenkins home and Docker socket | OWNER APPROVAL REQUIRED | Proposal 3: `docker rm festive_elgamal` (no `-v`)                                            |
| Docker clean-up (agent image tags, DEV container, staging image, volume)     | OWNER APPROVAL REQUIRED | Proposal 3, with measured sizes                                                              |
| `main` #1 artifacts (synthetic usernames)                                    | OWNER APPROVAL REQUIRED | Delete the build, or retention removes it at `main` #21                                      |
| `uat:deploy` outside the approval                                            | COMPLETED (documented)  | Owner-only rollback tool; `docker-users` holds only the owner; agents told never to run it   |
| Docker-socket redesign or dedicated deployment agent                         | DEFERRED                | Single-user workstation, no untrusted builds; matrix authorization covers the practical risk |
