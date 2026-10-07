# CI/CD: PR Smoke, merge, QA Regression, approval, UAT Smoke

One `Jenkinsfile`, one **Multibranch Pipeline**. Every build creates the ParaBank image exactly once
and the environments run that image by ID. The mandatory sequence is:

```
Pull Request ─> QA Smoke (4) ─> required Jenkins check passes ─> manual GitHub merge
  ─> QA Regression (24) ─> manual Jenkins approval ─> UAT deployment ─> UAT Smoke (4)
```

```
PULL REQUEST (CI)  QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA SMOKE (4)
                   = the "Jenkins" check GitHub requires before the merge button works

MAIN (CD)          QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA REGRESSION (24)
                     ─> UAT APPROVAL (input; authorized approver; timeout)
                     ─> VERIFY APPROVED IMAGE ─> PROMOTE SAME IMAGE ID ─> UAT READY ─> UAT SMOKE (4)
                     [─> KNOWN DEFECTS (optional, never gating)] ─> DEPLOYMENT RECORD
```

```
QA REGRESSION ──fail──> FAILURE (no approval requested, nothing deployed to UAT)
      │ pass
      ▼
UAT APPROVAL ──reject / timeout / abort──> ABORTED (nothing deployed to UAT)
      │       ──not an authorized approver / approvers not configured──> FAILURE (nothing deployed)
      │ approved by an authorized approver
      ▼
VERIFY ─> PROMOTE ─> UAT READY ─> UAT SMOKE ──fail──> FAILURE (no deployment record)
                                      │ pass 4/4
                                      ▼
                                   SUCCESS
```

A Pull Request never runs Regression and never deploys to UAT. The main pipeline runs no QA Smoke
and no UAT Regression; it is SUCCESS only if UAT Smoke and its count check pass.

## Repository, branches and merge protection

- **Repository:** https://github.com/vassilva/Automacao-ParaBank-Playwright (public; `main` is the
  default branch). Work happens on `feature/*` branches and reaches `main` only through a PR.
- **Required check:** the GitHub check run **`Jenkins`**, published by the GitHub App
  `jenkins-qa-automation` (app ID **4991392**) for every Jenkins build. For a PR build it carries the
  result of the whole PR pipeline, i.e. QA Smoke and its count check. Observed on PR #1, together
  with `Tests / Build, Deploy and Validate` (named after a stage, so it changes when stages are
  renamed) and the commit status `continuous-integration/jenkins/pr-head` (named after the PR
  discovery strategy). `Jenkins`, pinned to the App's integration ID, is the stable choice: no other
  app or user can satisfy it.
- **Protection (to be applied, see Manual configuration):** the repository ruleset
  [`github-ruleset-main.json`](github-ruleset-main.json) on the default branch requires a pull
  request, requires the `Jenkins` check from app 4991392 to pass on a branch that is up to date with
  `main` (a failing, pending or missing check blocks the merge button), blocks direct pushes,
  force-pushes and deletion, and has **no bypass actors**. It requires no review approval, because a
  single maintainer cannot approve their own PR; the merge itself stays a manual click. Auto-merge is
  disabled for the repository (`allow_auto_merge: false`) and is not used. Rulesets and branch
  protection are available on public repositories on every GitHub plan.
- **Jenkins job:** Multibranch Pipeline `Automacao-ParaBank-Playwright` (GitHub Branch Source,
  credential `github-app-qa-automation`), created in the Jenkins UI as a copy of the ServeRest job.
  Discovery: branches excluding those filed as PRs; PRs from the repository itself at the PR head
  revision. The local Jenkins is not reachable from GitHub, so it relies on periodic scans; **the
  job currently has no periodic scan trigger** (see Manual configuration).

| Event                                     | Jenkins build           | What runs                                                                                               | UAT?           |
| ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| PR opened / updated (from this repo)      | `PR-<n>` (PULL REQUEST) | quality gates, build image, deploy QA, **QA Smoke (4)**; its result is the `Jenkins` check              | no             |
| Push to a `feature/*` branch without a PR | branch job (PUSH)       | same as a PR                                                                                            | no             |
| Manual merge into `main`                  | `main` (MAIN)           | quality gates, build image, deploy QA, **QA Regression (24)**, **approval**, promote, **UAT Smoke (4)** | after approval |

## Stages, in execution order

| #   | Stage                                 | PR / PUSH | MAIN | What it does                                                                                                                                                                                                            |
| --- | ------------------------------------- | :-------: | :--: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Build Context                         |     ✓     |  ✓   | Build mode (`CHANGE_ID` → PR; `PARABANK_MAIN_BRANCH`, default `main` → MAIN; otherwise PUSH), build image tag                                                                                                           |
| 2   | **Build and QA** (agent, host lock)   |     ✓     |  ✓   | Workspace Guard (1 worker, 0 retries, no `.env`) → Install → Quality Gates → Acquire Host Lock → Build Image (once) → Deploy QA → QA Ready (healthy, database initialized, exact image ID)                              |
| 2a  | ↳ QA Smoke                            |     ✓     |  –   | CI gate: `test:smoke`, then 4/4 executed once and passed                                                                                                                                                                |
| 2b  | ↳ QA Regression                       |     –     |  ✓   | **Deployment gate**: `test:regression`, then 24/24 executed once and passed                                                                                                                                             |
| 2c  | ↳ QA Additional Suite                 |    opt    | opt  | Parameter `ADDITIONAL_QA_SUITE` = `sanity` (10) or `full` (52), after the QA gate passed                                                                                                                                |
| 3   | **UAT Approval** (no agent, no lock)  |     –     |  ✓   | Only if QA Regression passed. Mandatory `input`, restricted to `PARABANK_UAT_APPROVERS`, timeout `PARABANK_UAT_APPROVAL_MINUTES` (default 60)                                                                           |
| 4   | **UAT Deployment** (agent, host lock) |     –     |  ✓   | Only after an authorized approval: Workspace Guard → Install → Host Lock → Verify Approved Image → Promote to UAT (same image ID, no rebuild) → UAT Ready (healthy, database initialized, identity = approved image ID) |
| 4a  | ↳ UAT Smoke                           |     –     |  ✓   | Post-deployment verification: `test:smoke`, then 4/4                                                                                                                                                                    |
| 4b  | ↳ Known Defects                       |     –     | opt  | Parameter `RUN_KNOWN_DEFECTS`, after UAT Smoke passed: 25 known-defect scenarios; at most UNSTABLE                                                                                                                      |
| 4c  | ↳ Deployment Record                   |     –     |  ✓   | `deployment/deployment-record.txt`: source commit, built/QA/UAT image IDs, approver, validation counts                                                                                                                  |

The approval runs between two agent stages on purpose: while it waits, the pipeline holds **no
executor, workspace or host lock**, so other pipelines (PR builds, other jobs) keep running. The
host lock is released after QA and acquired again for UAT; the approved image is checked again
before promotion (same ID as the one QA Regression validated, still present, built from the pinned
commit). The build's image tag is kept only while an approval is pending; a reject, timeout or abort
removes it (pipeline `post`), so a rejected image can never be promoted later by mistake.

## Approval: who can approve

- `PARABANK_UAT_APPROVERS` (Jenkins global property, **required**): comma-separated Jenkins user
  IDs. If it is unset or empty, the approval stage fails and nothing is deployed.
- The `input` is restricted to those users (`submitter`), and the pipeline **checks the approver
  again** after the input returns (`submitterParameter`), failing without deploying if the approver
  is not in the list.
- Why both: this Jenkins uses "Logged-in users can do anything", so every account (`admin`,
  `noreply`, `viamerico`) is a Jenkins administrator, and Jenkins lets administrators answer any
  input regardless of `submitter`. The pipeline-side check still refuses to deploy for anyone not in
  `PARABANK_UAT_APPROVERS`. To stop other accounts from even clicking, restrict Jenkins
  authorization (Matrix-based security) or disable the unused accounts: a Jenkins setting outside
  this repository.
- Reject, timeout (default 60 minutes) or abort end the build ABORTED with no UAT stage executed.

## Gates

1. Stages run in sequence: a failing suite (or its count check) fails its stage, the build is FAILED,
   and every later stage is skipped.
2. Each later step also requires the previous gate's own flag, set only as the last statement of
   that stage: the approval requires `QA_REGRESSION_PASSED`; the UAT deployment requires
   `UAT_APPROVED` (set only after the approver check); UAT Smoke requires `UAT_READY`; the
   deployment record and known defects require `UAT_SMOKE_PASSED`.
3. No retries (`CUCUMBER_RETRY=0`, checked by both Workspace Guards), no ignored exit codes around
   suites, and every suite run is compared with its approved size.

Checked locally (not a Jenkins run): the Jenkinsfile parses with the Groovy runtime bundled in the
lab Jenkins (a deliberately broken copy does not), and a simulation that evaluates the Jenkinsfile's
own `when` expressions gives: PR and PUSH → QA Smoke only; MAIN → QA Regression → approval →
verify → promote → UAT Ready → UAT Smoke → deployment record; failed QA Regression → FAILURE, no
approval; reject or timeout → ABORTED before any UAT stage; unauthorized or unconfigured approver →
FAILURE before any UAT stage; failed verification, UAT readiness or UAT Smoke → FAILURE, no
deployment record.

## Gate drills (proving the gates in Jenkins)

`GATE_DRILL` (MAIN builds only, default `none`) points one suite at a port of its container on
which nothing listens. Every scenario then fails for real, at transport level, without changing
any test or either environment:

- `fail-qa-regression`: QA Regression fails → FAILURE, **no approval requested, nothing deployed to
  UAT**.
- `fail-uat-smoke` (approve when asked): UAT Smoke fails → FAILURE, no deployment record.

The approval gate itself is proven by rejecting (or letting time out) one normal MAIN build:
ABORTED, UAT untouched. Run a normal build afterwards to leave QA and UAT validated again.

## Suite counts and the coverage validator

`scripts/ci/verify-suite-coverage.ts --suite <smoke|sanity|regression|full> --expect <N> [dir]`
validates **one suite at a time**: the suite's inventory (Cucumber dry run of its profile) must be
exactly the approved size (`SMOKE_EXPECTED=4`, `REGRESSION_EXPECTED=24`, `SANITY_EXPECTED=10`,
`FULL_EXPECTED=52` in the Jenkinsfile, and docs/test-suites.md); with a reports directory, the run
must have executed exactly that inventory, every scenario once, all passed. It never assumes that
suites add up to another suite. The dry run writes to a relative directory under `reports/`, so it
works on Windows as well as Linux.

## Environments

|                 | QA                                             | UAT                                                     |
| --------------- | ---------------------------------------------- | ------------------------------------------------------- |
| Compose project | `parabank-qa`                                  | `parabank-uat`                                          |
| Local URL       | `http://localhost:8090/parabank/`              | `http://localhost:8091/parabank/`                       |
| From the agent  | `http://parabank-qa-parabank-1:8080/parabank/` | `http://parabank-uat-parabank-1:8080/parabank/`         |
| Database        | own container, fresh per deploy                | own container, fresh per deploy                         |
| Deployed by     | every build (PR, push and main)                | MAIN builds that passed QA Regression and were approved |
| Tested with     | Smoke (PR, push) or Regression (main)          | Smoke                                                   |
| After the build | left running                                   | left running                                            |

QA is shared: after a PR build it runs that PR's candidate image, while UAT keeps the last image
promoted from `main`. Both are defined once in `src/support/environments.ts` and managed by
`scripts/environment.ts` (`npm run qa:deploy|start|stop|status|health`, the same for `uat:`, and
`npm run env:identity`). The same tests target either one by configuration only (`TARGET_ENV`);
Jenkins also sets `PARABANK_BASE_URL` to the container address.

## Build once, promote the same image

- The image is built once per pipeline; its ID (`sha256:…`) is the identity. Tags are only pointers
  for humans (`parabank-ci:<build>`, removed after the build; `parabank-qa:current` and
  `parabank-uat:current`).
- `compose.yaml` has **no default image**: QA and UAT can only be started with an explicit image ID.
- Promotion deploys the image ID QA runs, after checking it equals the built ID; UAT Ready then
  reads the image ID of both running containers from Docker and fails unless built = QA = UAT.

## Known defects in CI

The 25 known-defect scenarios document confirmed product defects (docs/defects.md) and are not
part of any gate. On MAIN, `RUN_KNOWN_DEFECTS=true` runs them on UAT after UAT Smoke passed; a
scenario that no longer reproduces, or fails for another reason, marks the build UNSTABLE (never
FAILED). Their Playwright report goes to `reports/uat/known-defects/`.

## Reporting and evidence

Reports are separated per environment and suite: `reports/qa/smoke` (PR, push),
`reports/qa/regression` (main), `reports/qa/<sanity|full>` (optional), `reports/uat/smoke`,
`reports/uat/known-defects` (optional), plus `reports/logs/qa.log` and `reports/logs/uat.log`.
Published: JUnit of every run; archived: the reports, the redacted container logs, the application
build log and provenance record (`build/`), and the deployment record (`deployment/`). Failure
messages, attachments and Playwright step titles are redacted, screenshots are masked before
capture, and Playwright traces are never produced in CI.

**Logs the project does not author** go through `scripts/log-redaction.ts` line by line before they
are written anywhere: the ParaBank container logs (which print every customer's username, password
and SSN) and the ParaBank image build output (whose upstream tests print the vendor demo customer
and sample SSNs), which reaches both the Jenkins console and `build/parabank-build.log`. Credential
fields (`username`, `password`, `ssn`, also as JSON), session ids, authorization headers, the
shapes of this suite's generated credentials and every SSN-shaped value are masked; a line that
still looks like a credential is withheld. Replayed on the logs of the first two Jenkins builds:
0 credential values remain, and all 73 "Tests run" lines (used for the test totals) are kept.

### Artifacts archived before the log-redaction fix

The first two builds ran before `scripts/log-redaction.ts`. Their console logs and archived logs
contain unredacted synthetic usernames and the vendor demo credentials (counts, values not shown):

| Build     | File                       | username | password | SSN-shaped | generated usernames |
| --------- | -------------------------- | -------: | -------: | ---------: | ------------------: |
| `main` #1 | console log                |       61 |       61 |         25 |                   0 |
| `main` #1 | `build/parabank-build.log` |       61 |       61 |         25 |                   0 |
| `main` #1 | `reports/logs/qa.log`      |        6 |        0 |          0 |                   6 |
| `main` #1 | `reports/logs/uat.log`     |       46 |        0 |          0 |                  47 |
| `PR-1` #1 | console log                |       61 |       61 |         25 |                   0 |
| `PR-1` #1 | `build/parabank-build.log` |       61 |       61 |         25 |                   0 |
| `PR-1` #1 | `reports/logs/qa.log`      |       46 |        0 |          0 |                  47 |

(The single "password" match in each archived `cucumber-report.html` is the report viewer's own
JavaScript, `…number:!0,password:!0`, not data.)

**Recommended cleanup (manual, not automated; needs the job owner's approval):**

1. Merge this fix and confirm one new `main` build and one new PR build are green, so that clean
   history exists before anything is removed.
2. Check the new builds' archives and console logs with the counts above (expected: all zero).
3. Delete the two affected builds in the Jenkins UI: _Automacao-ParaBank-Playwright → main → #1 →
   Delete build_, and _→ Pull Requests → PR-1 → #1 → Delete build_ (PR-1's whole branch job also
   disappears once Jenkins prunes the merged PR). Deleting the build removes its console log and
   archive together; Jenkins has no UI to delete only one archived file, and editing files in the
   Jenkins home is not recommended.
4. Nothing else needs cleaning: the values are synthetic customers of throwaway environments and
   the vendor's public demo customer; no real credentials were involved.

## Concurrency

QA and UAT are shared by every job of the host, so the build, deploy and test part of a pipeline
holds a **host-wide lock** (`scripts/ci/host-lock.ts`): an atomic Docker network labelled with the
owner (`BUILD_TAG`); waiters poll for at most 60 min (`PARABANK_LOCK_WAIT_MINUTES`); a lock older
than 150 min (`PARABANK_LOCK_STALE_MINUTES`) is removed loudly; it is released in `post`, also on
failure or abort. `disableConcurrentBuilds()` covers one branch/PR job. Cucumber always runs with
one worker and no retries (checked by the Workspace Guard).

## Configuration

| Item                            | Where                   | Default | Meaning                                                                    |
| ------------------------------- | ----------------------- | ------- | -------------------------------------------------------------------------- |
| `PARABANK_UAT_APPROVERS`        | Jenkins global property | (none)  | **Required for MAIN**: Jenkins user IDs allowed to approve UAT deployments |
| `PARABANK_UAT_APPROVAL_MINUTES` | Jenkins global property | `60`    | Approval timeout; expiry → ABORTED, nothing deployed                       |
| `PARABANK_MAIN_BRANCH`          | Jenkins global property | `main`  | Branch whose builds are the CD pipeline                                    |
| `RUN_KNOWN_DEFECTS`             | Build parameter (MAIN)  | `false` | Run the known defects on UAT after UAT Smoke                               |
| `ADDITIONAL_QA_SUITE`           | Build parameter         | `none`  | `sanity` or `full` on QA after the QA gate                                 |
| `GATE_DRILL`                    | Build parameter (MAIN)  | `none`  | `fail-qa-regression` or `fail-uat-smoke` (see drills)                      |

Agent requirements: a Docker-capable Jenkins with the Docker Pipeline plugin and the Pipeline: Input
Step plugin, access to the host Docker socket, a `built-in` node with executors (removing a build's
image tag after a rejected approval), and host ports 8090 and 8091 free for QA and UAT.

## Manual configuration (not done; needs the owner's authorization)

1. **Jenkins global property** `PARABANK_UAT_APPROVERS` = your Jenkins user ID (Manage Jenkins →
   System → Global properties → Environment variables). Optionally `PARABANK_UAT_APPROVAL_MINUTES`.
2. **Jenkins job scanning:** Automacao-ParaBank-Playwright → Configure → Scan Multibranch Pipeline
   Triggers → "Periodically if not otherwise run", 2 minutes.
3. **Optional Jenkins hardening:** Matrix-based security (or disabling unused accounts) so that only
   the approver can click the approval at all.
4. **GitHub ruleset:** apply `docs/github-ruleset-main.json` (Settings → Rules → Rulesets → New
   ruleset → Import a ruleset, or
   `gh api -X POST repos/vassilva/Automacao-ParaBank-Playwright/rulesets --input docs/github-ruleset-main.json`),
   then confirm on an open PR that the merge button is blocked while the `Jenkins` check is pending.
5. **First runs:** push this branch and open a PR (PR Smoke) → merge manually → MAIN: QA Regression →
   approve → UAT Smoke. Then the drills: `fail-qa-regression`, one rejected approval, and
   `fail-uat-smoke`; finish with one normal MAIN build.

## Validation status

**Real Jenkins builds (earlier pipeline designs):** `main` #1 SUCCESS (image `sha256:c0cfd5a7…`
built once, QA Smoke 4/4, same image ID promoted to UAT, UAT Smoke 4/4, UAT Regression 24/24) and
`PR-1` #1 SUCCESS (QA Smoke 4/4, QA Regression 24/24, no UAT stage), 2026-10-07.

**Not yet executed in Jenkins:** the current design (PR Smoke only; main QA Regression → approval →
UAT Smoke), the approval, the test-data audit gate, both gate drills and the log redaction. Checked
locally: static checks, Groovy parse, the stage-path simulation above, and the log redaction on real
container logs and a real ParaBank build.

## Readiness: database initialized

ParaBank creates its database lazily, on home-page requests. The container healthcheck's bare
HTTP/1.0 probe triggers that initialization but never completes it, so a freshly deployed
container reports "healthy" while registration still fails with HTTP 500 ("object not found:
SEQUENCE"). `scripts/environment.ts` therefore makes one complete home-page request and then
requires the application's own "Database initialized" log line since the container started (a
database kept across a restart logs neither message and is ready at once). `deploy` returns only
then, and the QA Ready / UAT Ready stages use the same check. The log is only searched for that
line, never printed or stored.
