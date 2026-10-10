# CI/CD: role validation, PR checks, auto-merge, QA Regression, approval, UAT Smoke

One `Jenkinsfile`, one **Multibranch Pipeline**. Every build that deploys creates the ParaBank image
exactly once and the environments run that image by ID. The target flow is:

```
Developer / QA / Configurator ─> push ─> role-specific validation ─> Pull Request
  ─> Quality Gates + QA Smoke (4) + QA Impacted Tests  (= the required "Jenkins" check)
  ─> GitHub auto-merge (enabled per eligible PR, merges only after the check passed)
  ─> main: automatic QA deployment ─> QA Regression (24) ─> mandatory manual Jenkins approval
  ─> UAT deployment (same image ID) ─> UAT Smoke (4)
```

```
PUSH, by branch prefix (a branch with an open PR is built as the PR only):
  feature/*, others  DEVELOPER     QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA SMOKE (4)
  qa/*               QA            QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA IMPACTED TESTS
  config/*           CONFIGURATOR  QUALITY GATES ─> CONFIG CHECK          (no image, no deployment, no lock)

PULL REQUEST (CI)  QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA SMOKE (4) ─> QA IMPACTED TESTS
                   = the "Jenkins" check GitHub requires before a merge or an auto-merge

MAIN (CD)          QUALITY GATES ─> BUILD IMAGE ─> DEPLOY QA ─> QA READY ─> QA REGRESSION (24)
                     ─> UAT APPROVAL (input; authorized approver; timeout; supersedes older waiting builds)
                     ─> VERIFY APPROVED IMAGE (still main's head) ─> PROMOTE SAME IMAGE ID ─> UAT READY
                     ─> UAT SMOKE (4) [─> KNOWN DEFECTS (optional, never gating)] ─> DEPLOYMENT RECORD
```

```
QA REGRESSION ──fail──> FAILURE (no approval requested, nothing deployed to UAT)
      │ pass
      ▼
UAT APPROVAL ──reject / timeout / abort / superseded──> ABORTED (nothing deployed to UAT)
      │       ──not an authorized approver / approvers not configured──> FAILURE (nothing deployed)
      │ approved by an authorized approver
      ▼
VERIFY ──main moved on──> ABORTED "SUPERSEDED" (nothing deployed)
      │
      ▼
PROMOTE ─> UAT READY ─> UAT SMOKE ──fail──> FAILURE (no deployment record)
                            │ pass 4/4
                            ▼
                         SUCCESS
```

A Pull Request never deploys to UAT. The main pipeline runs no QA Smoke and no UAT Regression; it
is SUCCESS only if UAT Smoke and its count check pass. Auto-merge changes only **who clicks merge**
(GitHub, once the required check passed): every gate after the merge is unchanged, and nothing
reaches UAT without the manual Jenkins approval.

## Roles: push validation by branch prefix

| Branch      | Role         | Validation on push (no PR yet)                                           | Deploys QA? |
| ----------- | ------------ | ------------------------------------------------------------------------ | :---------: |
| `feature/*` | Developer    | Quality Gates, build image, deploy QA, **QA Smoke (4)**                  |     yes     |
| `qa/*`      | QA           | Quality Gates, build image, deploy QA, **QA Impacted Tests** (vs `main`) |     yes     |
| `config/*`  | Configurator | Quality Gates, **Config Check** (`scripts/ci/config-check.ts`)           |     no      |
| other       | Developer    | as `feature/*`                                                           |     yes     |

The Config Check renders `compose.yaml` for QA and UAT exactly as `scripts/environment.ts` would,
and fails unless each renders with its own Compose project and its own loopback port, the image is
the one passed in, and Compose refuses to render without an image (no silent default image). It
needs no lock and never touches QA or UAT, so a `config/*` push is never queued behind a QA build
(measured locally: Quality Gates + Config Check ≈ 75 s, plus `npm ci` and the agent start).

**A `config/*` push is not the configuration's validation.** Once a PR is open, every branch,
whatever its prefix, is validated by the full PR plan: Quality Gates, Config Check, build, deploy
QA, **QA Smoke (4)** and **QA Impacted Tests**. Jenkins discovers branches "excluding those filed as
PRs", so an open PR is never built with the lighter push plan, and the PR check is the one GitHub
requires. Configuration files select the whole Regression (24): `compose.yaml`,
`src/support/environments.ts`, `src/support/config.ts`, `docker/parabank/**` (application version
and build), `cucumber.js`, `package*.json`, `tsconfig.json`, Playwright configs, the Jenkinsfile,
`scripts/**` and the CI agent image. No configuration-specific business tests are added: ParaBank's
behaviour is covered by the existing scenarios, and Regression is the strongest set that runs on QA.

## QA Impacted Tests (pull requests and `qa/*` pushes)

`scripts/ci/impacted-tests.ts` compares the change with its target (`origin/$CHANGE_TARGET` for a
PR, `origin/main` for a push) at the **merge base**, so later commits on `main` do not count. Jenkins
PR checkouts fetch only the PR ref, so the script fetches the target branch anonymously from the
(public) repository when it is missing; if it cannot, the stage fails (fail-closed).

| Changed files                                                                                                                                                                                                                                                                  | Runs                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| a feature file                                                                                                                                                                                                                                                                 | that feature                    |
| a domain's steps or page object (e.g. `transfer.steps.ts`, `bill-pay.page.ts`)                                                                                                                                                                                                 | that domain's features          |
| shared code: `src/support`, `src/api`, `src/factories`, `src/utils`, shared steps (customer, feedback, ledger) and pages (home, menu, feedback, index), `playwright/`, Playwright configs, `cucumber.js`, `package*.json`, `tsconfig.json`, `docker/parabank/`, `compose.yaml` | **Regression (24)**             |
| CI/CD tooling (high risk): `Jenkinsfile`, `scripts/**`, `docker/ci-agent/**`, `.gitattributes`                                                                                                                                                                                 | **Regression (24)**             |
| documentation (`docs/**`, `*.md`), the secondary `.github/` workflow, lint/format/ignore rules (checked by the Quality Gates), `.env.example` (never loaded in CI)                                                                                                             | nothing beyond Smoke            |
| anything the map does not know (e.g. a new page object)                                                                                                                                                                                                                        | **Regression (24)** (fail-safe) |

Known-defect scenarios are never selected (the `full` profile excludes them); a selection that
contains only known defects runs nothing and does not gate. After the run, the coverage validator
checks that exactly the selected scenarios ran, once each, and passed (`--paths` for a feature
selection, `--expect 24` for Regression). The selection is archived as
`reports/qa/impacted/selection.json`. The map lives in the script (`RULES`); a new domain needs a
new rule, and until then its files select Regression. Renames list both the old and the new path
(`--no-renames`), so moving shared code into a domain file still selects Regression.

**Gate-defining changes** (`GATE_DEFINING`: the Jenkinsfile, `scripts/ci/**`, the test-data audit,
`cucumber.js`, `package*.json`, `tsconfig.json`, the Playwright adapter and configs, the CI agent
image, lint/format configs, the ruleset file) are reported in the console and in `selection.json`
as `GATE-DEFINING CHANGE`. Jenkins validates a PR with **the PR's own Jenkinsfile and scripts**, so
such a PR can weaken the checks that judge it; it is merged manually after review, never
auto-merged (see the auto-merge policy).

## Repository, branches and merge protection

- **Repository:** https://github.com/vassilva/Automacao-ParaBank-Playwright (public; `main` is the
  default branch). Work happens on `feature/*` branches and reaches `main` only through a PR.
- **Required check:** the GitHub check run **`Jenkins`**, published by the GitHub App
  `jenkins-qa-automation` (app ID **4991392**) for every Jenkins build. For a PR build it carries the
  result of the whole PR pipeline: Quality Gates, Config Check, QA Smoke, QA Impacted Tests, their
  count checks, and the final **Validation Complete** stage, which fails the build unless every
  validation of the plan actually ran and passed (a skipped stage never counts as a pass). Observed
  on PR #1, together with `Tests / Build, Deploy and Validate` (named after a stage, so it changes
  when stages are renamed; not required) and the commit status
  `continuous-integration/jenkins/pr-head` (named after the PR discovery strategy). Both `Jenkins`
  and the status are posted by app 4991392 (`jenkins-qa-automation[bot]`).
- **Why two required signals.** Read from the installed plugins (checks-api 402,
  github-branch-source 1967):

  | Jenkins result | `Jenkins` check run                | `pr-head` commit status | GitHub treats it as |
  | -------------- | ---------------------------------- | ----------------------- | ------------------- |
  | SUCCESS        | success                            | success                 | pass                |
  | UNSTABLE       | neutral (if configured) or failure | failure                 | **neutral = pass**  |
  | FAILURE        | failure                            | error                   | fail                |
  | NOT_BUILT      | **skipped**                        | error                   | **skipped = pass**  |
  | ABORTED        | cancelled                          | error                   | fail                |
  | running        | in progress                        | pending                 | blocks              |

  GitHub counts a skipped or neutral required **check** as passing; a commit **status** passes only
  when `success`. The pipeline therefore never ends a PR build NOT_BUILT or UNSTABLE (no milestones
  on PR/branch builds; `post`: NOT_BUILT → ABORTED, UNSTABLE → FAILURE), and the ruleset requires
  **both** the `Jenkins` check and the `continuous-integration/jenkins/pr-head` status from app
  4991392, so that even a regression of the pipeline cannot turn a non-validated build into a merge.
  Caveat: the status name follows Jenkins' PR discovery strategy; switching to "merge" would rename
  it to `pr-merge` and block every PR until the ruleset is updated (fail-safe).

- **Protection (to be applied, see Manual configuration):** the repository ruleset
  [`github-ruleset-main.json`](github-ruleset-main.json) on the default branch requires a pull
  request, requires the `Jenkins` check and the `pr-head` status from app 4991392 to pass on a
  branch that is up to date with `main` (a failing, pending or missing check blocks the merge),
  blocks direct pushes, force-pushes and deletion, and has **no bypass actors**. It requires no
  review approval, because a single maintainer cannot approve their own PR. Rulesets and branch
  protection are available on public repositories on every GitHub plan. The repository owner can
  still edit or disable the ruleset; that is an administrative action outside any PR.
- **Up to date, not a merge queue:** merge queues are available only for organization-owned
  repositories; this repository belongs to a user account. "Require branches to be up to date"
  (`strict_required_status_checks_policy: true`) gives the same guarantee for one PR at a time: the
  `Jenkins` check must have passed on the PR head **including the current `main`**. When `main`
  moves, the PR is out of date and cannot merge (auto-merge waits) until it is updated (the "Update
  branch" button, enabled by `allow_update_branch`) and Jenkins has passed again on the new head.
  Jenkins builds PRs at their head revision, so the validated revision is exactly what merges.
- **Auto-merge policy (enabled per PR, never by default):** the repository setting
  `allow_auto_merge` only makes the option available; nothing enables it automatically. It is
  enabled intentionally, per eligible PR, by its author or a maintainer:
  `gh pr merge <n> --auto --merge` (or "Enable auto-merge" on the PR). A PR is eligible when it is
  ready for review (not a draft), targets `main`, comes from this repository, its author wants it in
  `main` as soon as it is validated, and its Jenkins log shows **no `GATE-DEFINING CHANGE`**. A PR
  that changes the Jenkinsfile, `scripts/ci/**`, the runner configuration or the agent image is
  reviewed and merged manually: it is judged by the very checks it modifies. GitHub then merges an
  eligible PR only when every ruleset rule is satisfied: the `Jenkins` check and the `pr-head`
  status passed on an up-to-date head. A missing, pending, failing, cancelled or errored signal
  blocks the merge; a new push re-runs the check and the merge waits for it. GitHub
  disables auto-merge itself if someone without write access pushes to the PR branch or the base
  branch is changed. `gh pr merge <n> --disable-auto` cancels it.
- **Jenkins job:** Multibranch Pipeline `Automacao-ParaBank-Playwright` (GitHub Branch Source,
  credential `github-app-qa-automation`), created in the Jenkins UI as a copy of the ServeRest job.
  Discovery: branches excluding those filed as PRs; PRs from the repository itself at the PR head
  revision. The local Jenkins is not reachable from GitHub, so it relies on periodic scans; **the
  job currently has no periodic scan trigger** (see Manual configuration).

| Event                                | Jenkins build           | What runs                                                                                               | UAT?           |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------- | -------------- |
| Push to a branch without a PR        | branch job (PUSH)       | by prefix: `feature/*` Smoke, `qa/*` Impacted Tests, `config/*` Config Check (see Roles)                | no             |
| PR opened / updated (from this repo) | `PR-<n>` (PULL REQUEST) | quality gates, build image, deploy QA, **QA Smoke (4)**, **QA Impacted Tests**; = the `Jenkins` check   | no             |
| Merge into `main` (auto or manual)   | `main` (MAIN)           | quality gates, build image, deploy QA, **QA Regression (24)**, **approval**, promote, **UAT Smoke (4)** | after approval |

## Stages, in execution order

| #   | Stage                                 | PR / PUSH | MAIN | What it does                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------- | :-------: | :--: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Build Context                         |     ✓     |  ✓   | Build mode (`CHANGE_ID` → PR; `PARABANK_MAIN_BRANCH`, default `main` → MAIN; otherwise PUSH), push role by prefix, build image tag                                                                                                                                                                                 |
| 2   | **Build and QA** (agent, host lock)   |     ✓     |  ✓   | Workspace Guard (1 worker, 0 retries, no `.env`; PR/branch: superseded → ABORTED) → Install → Quality Gates → [Config Check: PR and `config/*`; `config/*` stops here] → Acquire Host Lock (then superseded → ABORTED) → Build Image (once) → Deploy QA → QA Ready (healthy, database initialized, exact image ID) |
| 2a  | ↳ QA Smoke                            |  PR, dev  |  –   | CI gate: `test:smoke`, then 4/4 executed once and passed                                                                                                                                                                                                                                                           |
| 2b  | ↳ QA Impacted Tests                   |  PR, qa   |  –   | `ci:impacted run`: the change's selection (see above), then exactly the selected scenarios executed once and passed                                                                                                                                                                                                |
| 2c  | ↳ QA Gate                             |     ✓     |  –   | Fails unless every suite the role requires ran and passed; then sets `QA_GATE_PASSED` (not for `config/*`)                                                                                                                                                                                                         |
| 2d  | ↳ QA Regression                       |     –     |  ✓   | **Deployment gate**: `test:regression`, then 24/24 executed once and passed                                                                                                                                                                                                                                        |
| 2e  | ↳ QA Additional Suite                 |    opt    | opt  | Parameter `ADDITIONAL_QA_SUITE` = `sanity` (10) or `full` (52), after the QA gate passed                                                                                                                                                                                                                           |
| 2f  | **Validation Complete** (no agent)    |     ✓     |  –   | Fails unless every flag of the plan is set (PR: Config Check, Smoke, Impacted Tests, QA Gate); a skipped stage never counts as a pass                                                                                                                                                                              |
| 3   | **UAT Approval** (no agent, no lock)  |     –     |  ✓   | Only if QA Regression passed. Milestone (supersedes older waiting builds), mandatory `input` restricted to `PARABANK_UAT_APPROVERS`, timeout `PARABANK_UAT_APPROVAL_MINUTES` (default 60), approver re-checked, milestone "UAT approved"                                                                           |
| 4   | **UAT Deployment** (agent, host lock) |     –     |  ✓   | Only after an authorized approval: Workspace Guard → Install → Host Lock → Verify Approved Image (commit still main's head, same image ID) → Promote to UAT (same image ID, no rebuild) → UAT Ready (healthy, database initialized, identity = approved)                                                           |
| 4a  | ↳ UAT Smoke                           |     –     |  ✓   | Post-deployment verification: `test:smoke`, then 4/4                                                                                                                                                                                                                                                               |
| 4b  | ↳ Known Defects                       |     –     | opt  | Parameter `RUN_KNOWN_DEFECTS`, after UAT Smoke passed: 25 known-defect scenarios; at most UNSTABLE                                                                                                                                                                                                                 |
| 4c  | ↳ Deployment Record                   |     –     |  ✓   | `deployment/deployment-record.txt`: source commit, built/QA/UAT image IDs, approver, validation counts                                                                                                                                                                                                             |

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
- Reject, timeout (default 60 minutes), abort or supersession by a newer `main` build end the
  build ABORTED with no UAT stage executed.

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
own `when` expressions gives: PR → QA Smoke → QA Impacted Tests → QA Gate; `feature/*` and other
pushes → QA Smoke → QA Gate; `qa/*` → QA Impacted Tests → QA Gate; `config/*` → Quality Gates →
Config Check, with no lock, image, deployment or QA teardown; MAIN → QA Regression → approval →
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
must have executed exactly that inventory, every scenario once, all passed. For impacted tests,
`--paths <a.feature,b.feature>` replaces `--expect`: the inventory is the suite's profile restricted
to those files, which has no approved size but must not be empty. It never assumes that
suites add up to another suite. The dry run writes to a relative directory under `reports/`, so it
works on Windows as well as Linux.

## Environments

|                 | QA                                                        | UAT                                                     |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Compose project | `parabank-qa`                                             | `parabank-uat`                                          |
| Local URL       | `http://localhost:8090/parabank/`                         | `http://localhost:8091/parabank/`                       |
| From the agent  | `http://parabank-qa-parabank-1:8080/parabank/`            | `http://parabank-uat-parabank-1:8080/parabank/`         |
| Database        | own container, fresh per deploy                           | own container, fresh per deploy                         |
| Deployed by     | every build except `config/*` pushes                      | MAIN builds that passed QA Regression and were approved |
| Tested with     | Smoke and/or Impacted Tests (PR, push), Regression (main) | Smoke                                                   |
| After the build | left running                                              | left running                                            |

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
`reports/qa/impacted` (PR, `qa/*`; with `selection.json`),
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
failure or abort, and only by its owner. Cucumber always runs with one worker and no retries
(checked by the Workspace Guard). The atomicity was checked on the lab daemon (Docker 29.7.2):
5 rounds of 12 simultaneous `docker network create` of one name produced exactly one network each.

What the lock covers, per build: Build Image → Deploy QA → QA Ready → suites → QA teardown (PR,
`feature/*`, `qa/*`, `main`), and separately UAT promotion → UAT Smoke (`main`, after approval).
`config/*` pushes take no lock. The approval wait holds no lock, executor or workspace.

**Superseding.** `disableConcurrentBuilds()` is gone: it would make a newer `main` build wait behind
an older one sitting at the approval.

- **PR and branch builds use no milestone.** A build cancelled by a milestone ends NOT_BUILT, which
  the checks plugin publishes as a _skipped_ `Jenkins` check, and GitHub counts skipped required
  checks as passing (see "Why two required signals"). Instead, the build compares its commit with
  the PR/branch head (`git ls-remote`, URL never traced) in the Workspace Guard and again right
  after acquiring the lock (the long wait), and ends **ABORTED** ("SUPERSEDED", check
  _cancelled_, status _error_) if a newer commit exists. If the head cannot be read it continues:
  finishing a build is always safe. Two builds of the same commit both run to their own result.
- **`main` uses milestones** (decoded from the installed plugin 138.v78ca_76831a_43: passing ordinal
  _N_ aborts every older running build of the job whose last milestone is lower, and aborts the
  build itself if a newer one already passed _N_ or more). `main` builds run up to QA Regression in
  order (host lock). At the approval each passes ordinal = build number, which aborts any **older
  build still waiting for approval**, and aborts this build if a **newer** one already asked. After
  the approval each passes ordinal 1 000 000 000: a build already approved and deploying is never
  aborted by a newer one, and an older build approved after a newer one was approved is aborted.
  A cancelled `main` build (NOT_BUILT) is turned into ABORTED and its image tag removed. `main`'s
  check never gates a merge.
- Verify Approved Image reads `main`'s head: if `main` moved on since this build's commit, the build
  ends ABORTED "SUPERSEDED" before anything is deployed. Only the latest validated image can reach
  UAT.

**Shared QA risks and how they are handled:**

| Risk                                                             | Handling                                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two builds deploy or test QA at the same time                    | Host lock around build, deploy and test; one Cucumber worker                                                                                      |
| A PR build replaces the image QA Regression is testing           | Impossible while the lock is held; QA Regression runs inside the lock                                                                             |
| QA runs a PR candidate after the main build moved on to approval | Expected: approval and UAT use the image **ID**, not QA's current state; Verify Approved Image checks the image still exists and its revision     |
| Several PRs auto-merge in a row                                  | Each merge starts a `main` build; they validate in order; the newest reaching approval supersedes older waiting ones; the head check blocks older |
| A PR validated against an old `main`                             | Required check is strict (up to date): out-of-date PRs cannot merge until updated and re-validated                                                |
| A superseded PR build reports a passing check                    | No milestones on PR builds; NOT_BUILT → ABORTED, UNSTABLE → FAILURE; the ruleset also requires the `pr-head` status (success only)                |
| PR checks wait while another build holds QA                      | Bounded lock wait (60 min) and stage timeouts; superseded builds stop after the wait; the approval holds no lock                                  |

**Expected bottleneck.** Everything that deploys is serialized by the lock. Measured in the two
real builds, the ParaBank image build alone took 280 s and 315 s (it compiles the pinned source and
runs ParaBank's own 239 tests, `PARABANK_BUILD_FRESH=true`); locally, Regression (24) ran in 27 s
and one feature in 8 s; deploy + readiness are estimated at 1–2 minutes (not measured separately).
A PR or `main` build therefore holds the lock for an **estimated 7–10 minutes**, most of it in the
image build (whole builds: `main` #1 11.6 min, `PR-1` #1 19.9 min, earlier pipeline designs). Builds queue one after
another: about 6 builds waiting at once reach the 60-minute lock wait and fail (a failed check
blocks the merge: safe, but noisy). Auto-merge adds one `main` build per merged PR, and the strict
up-to-date rule makes every other open PR re-validate after each merge, so N open PRs cost roughly
N² / 2 builds when merged one by one.

**Not changed, on purpose:** the image build stays inside the lock. It does not touch QA, but the
lock was introduced because two pipelines building and testing ParaBank at once exhausted the lab's
Docker VM (3.7 GiB) and every Smoke step timed out (`scripts/ci/host-lock.ts`). Moving it out would
reintroduce that failure on this host.

**Future scaling (not implemented):**

1. Reuse the application image across PRs: the application is the pinned upstream commit, so a PR
   that does not touch `docker/parabank/**` could deploy an image already built from the same
   inputs (content-addressed tag, verified by revision label and image ID), cutting ~5 min from the
   lock. `main` keeps building fresh for provenance. Needs a decision on the "build once per
   pipeline" rule.
2. A larger Docker VM, then a separate build lock (CPU/memory) and QA lock (environment).
3. Ephemeral per-PR environments (one Compose project per PR on its own port) with a capacity
   limit; QA stays the shared integration environment for `main`.
4. A merge queue (if the repository moves to an organization) instead of strict up-to-date, so
   queued PRs are validated together once instead of re-validated after every merge.

## Configuration

| Item                            | Where                   | Default | Meaning                                                                    |
| ------------------------------- | ----------------------- | ------- | -------------------------------------------------------------------------- |
| `PARABANK_UAT_APPROVERS`        | Jenkins global property | (none)  | **Required for MAIN**: Jenkins user IDs allowed to approve UAT deployments |
| `PARABANK_UAT_APPROVAL_MINUTES` | Jenkins global property | `60`    | Approval timeout; expiry → ABORTED, nothing deployed                       |
| `PARABANK_MAIN_BRANCH`          | Jenkins global property | `main`  | Branch whose builds are the CD pipeline                                    |
| `RUN_KNOWN_DEFECTS`             | Build parameter (MAIN)  | `false` | Run the known defects on UAT after UAT Smoke                               |
| `ADDITIONAL_QA_SUITE`           | Build parameter         | `none`  | `sanity` or `full` on QA after the QA gate                                 |
| `GATE_DRILL`                    | Build parameter (MAIN)  | `none`  | `fail-qa-regression` or `fail-uat-smoke` (see drills)                      |

Agent requirements: a Docker-capable Jenkins with the Docker Pipeline, Pipeline: Input Step and
Pipeline: Milestone Step plugins, git in the agent image (the Playwright base image has it), access
to the host Docker socket, a `built-in` node with executors (removing a build's
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
   Minimum safe configuration (this file): target the default branch; **no bypass actors**; block
   deletion and force-pushes; require a pull request (0 approvals: a single maintainer cannot approve
   their own PR); require status checks **`Jenkins`** and **`continuous-integration/jenkins/pr-head`**,
   both pinned to app 4991392, with "require branches to be up to date" on. Not used: merge queue
   (organization repositories only), code-owner review (would block the only maintainer forever),
   push rulesets restricting file paths (GitHub offers them for private and internal repositories).
5. **GitHub repository settings** (only after the ruleset is active, so auto-merge can never merge
   an unvalidated PR):
   `gh api -X PATCH repos/vassilva/Automacao-ParaBank-Playwright -F allow_auto_merge=true -F allow_update_branch=true`
   (Settings → General → Pull Requests → "Allow auto-merge" and "Always suggest updating pull request
   branches"). This only makes auto-merge available; it is enabled per PR (see the policy above).
6. **First runs:** push this branch and open a PR (Smoke + Impacted Tests) → enable auto-merge on
   that PR → GitHub merges after the check → MAIN: QA Regression → approve → UAT Smoke. Then the
   drills: `fail-qa-regression`, one rejected approval, and `fail-uat-smoke`; one superseding check
   (two quick pushes to a PR: the older build ends ABORTED, its check "cancelled", never "skipped");
   finish with one normal MAIN build. The very first PR (this branch) changes the Jenkinsfile, so it
   is a GATE-DEFINING change: merge it **manually**, without auto-merge.

## Validation status

**Real Jenkins builds (earlier pipeline designs):** `main` #1 SUCCESS (image `sha256:c0cfd5a7…`
built once, QA Smoke 4/4, same image ID promoted to UAT, UAT Smoke 4/4, UAT Regression 24/24) and
`PR-1` #1 SUCCESS (QA Smoke 4/4, QA Regression 24/24, no UAT stage), 2026-10-07.

**Not yet executed in Jenkins:** the current design (role validation; PR Config Check + Smoke +
Impacted Tests + Validation Complete; auto-merge; main QA Regression → approval → UAT Smoke), the
approval, the milestones and head checks, the NOT_BUILT/UNSTABLE conversions, the config check, the
test-data audit gate, both gate drills and the log redaction.

**Checked locally:** static checks; Groovy parse; the stage-path simulation above; the milestone
superseding rules, modelled on the plugin's decoded cancel logic (older waiting build aborted by a
newer approval request; approved build not interrupted; older build aborted when a newer one asked
or was approved first); the result → GitHub mapping read from the installed checks-api and
github-branch-source plugins; the declarative post conditions `unstable` and `notBuilt` exist in
the installed pipeline-model-definition; fault injection on the simulation (each required PR or push
stage forced to skip → FAILURE, never SUCCESS); the host-lock primitive under 60 concurrent creates;
the impact map on 33 sample change sets (including configurator files, CI/CD tooling and a rename);
`--no-renames` on a real rename; `ci:impacted run` against the local QA environment from a throwaway worktree: Regression path
24/24, single-feature path 4/4 (`transfer-funds.feature`, known defects excluded), a known-defect-only
selection (no gate), and a missing base (fails closed); `ci:config-check` on QA and UAT; the log
redaction on real container logs and a real ParaBank build.

## Readiness: database initialized

ParaBank creates its database lazily, on home-page requests. The container healthcheck's bare
HTTP/1.0 probe triggers that initialization but never completes it, so a freshly deployed
container reports "healthy" while registration still fails with HTTP 500 ("object not found:
SEQUENCE"). `scripts/environment.ts` therefore makes one complete home-page request and then
requires the application's own "Database initialized" log line since the container started (a
database kept across a restart logs neither message and is ready at once). `deploy` returns only
then, and the QA Ready / UAT Ready stages use the same check. The log is only searched for that
line, never printed or stored.
