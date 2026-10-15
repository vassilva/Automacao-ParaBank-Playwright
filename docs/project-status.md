# Project status and closure

**Authoritative checklist:** [requirements-traceability.md](requirements-traceability.md), one row
per mandatory requirement with source, implementation, tests, evidence, status and next action, plus
the three architecture references and the ten AI-assisted workflows. This page only records what
closure needs.

## State (2026-10-14, evening)

`main` at `65de02f` after PRs #20 to #27; `main` #13 to #22 SUCCESS (QA Regression 24/24, UAT
Approval by the owner, UAT verified without redeployment because it already ran the validated
image, UAT Smoke 4/4, evidence scan OK). Merged feature branches are deleted automatically.

2026-10-15 (REQ-11, owner's updated workflow): pull requests are opened and auto-merged by
`.github/workflows/auto-pr.yml` only through the required Jenkins checks (PRs #29 to #32);
`main` #24 to #26 SUCCESS (Regression 24/24 once, UAT Approval by `viamerico`, UAT Smoke 4/4).
Branches merged by the automation are deleted by its sweep (run 38797516746, unattended), those
merged by people by `delete_branch_on_merge`.

Applied the same day with the owner's explicit approval ([security-hardening.md](security-hardening.md)):
Jenkins matrix authorization (REQ-21), encrypted backups with an owner-held key and removal of the
plaintext copies and rollback volumes (REQ-22), removal of the privileged leftover container
`festive_elgamal` (REQ-23). Accepted by the owner: REQ-15 as a future validation against its
documented criteria, REQ-30 with the written transcription of the reference images.

## What closure still needs

| Requirement                         | Needed                                                                                             | Blocks closure       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------- |
| REQ-21 Jenkins matrix authorization | The owner's login check: `viamerico` administers and can answer UAT Approval; `admin` is read-only | Yes, until confirmed |
| REQ-15 Real approved UAT redeploy   | Observed at the next genuine application-image change (accepted, criteria documented)              | No (accepted)        |
| REQ-30 Original images              | None (transcription accepted)                                                                      | No (accepted)        |

Closure is recorded by the owner once REQ-21 is confirmed.
