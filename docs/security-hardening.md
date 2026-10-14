# Security posture and hardening proposals

What protects the pipeline, the environments and the evidence today, verified on the real setup on
2026-10-14, and what is proposed. **Nothing in the "Proposals" sections is applied:** each one
changes live Jenkins, Docker or backup state and needs the repository owner's explicit approval.
Test-evidence protection (redaction, screenshots, traces, the evidence scan before publishing) is
described in the [README](../README.md#security-approach) and
[docs/ci-cd.md](ci-cd.md#reporting-and-evidence).

## Who can change what (verified 2026-10-14)

| Control                   | Current state                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merge into `main`         | Pull request required; checks `Jenkins` and `continuous-integration/jenkins/pr-head` required, branch up to date; no bypass actors; auto-merge disabled; the owner is the only collaborator                                                |
| Builds of untrusted code  | Jenkins discovers branches and pull requests of this repository only (no fork pull requests); a PR build runs that PR's own `Jenkinsfile`, so push access is what this trusts                                                              |
| UAT deployment in Jenkins | Only a `main` build, after QA Regression 24/24 and the UAT Approval input answered by a user in `PARABANK_UAT_APPROVERS` (checked again after the input); `main` #13 to #18 were all approved by the owner                                 |
| UAT deployment outside    | `npm run uat:deploy` / `npm run env -- deploy uat <id>`, or `docker compose`, from any account that can use this machine's Docker daemon: **not covered by the Jenkins approval**                                                          |
| Docker access             | The Windows group `docker-users` contains only the owner's account; containers that mount the Docker socket: `jenkins`, its build agents, and the stopped leftover `festive_elgamal` (see consequence 4)                                   |
| Jenkins authorization     | "Logged-in users can do anything"; anonymous read denied (HTTP 403); sign-up disabled; CSRF protection on; inbound agent port disabled; no job-level permissions                                                                           |
| Jenkins accounts          | `admin` and `viamerico` can log in (password set); `noreply` has no password (created from a commit author); no API tokens                                                                                                                 |
| Jenkins version           | 2.580.1 on Java 21; 0 update-center security warnings for the core and the 98 installed plugins (feed of 2026-10-13)                                                                                                                       |
| Network exposure          | Jenkins `127.0.0.1:8080`, QA `127.0.0.1:8090`, UAT `127.0.0.1:8091`: loopback only                                                                                                                                                         |
| Jenkins process           | Runs as root in its container with the host Docker socket mounted (as does the build agent): Jenkins administration is Docker-host administration                                                                                          |
| Jenkins credentials       | 4 global credentials: the GitHub App credential (shared by this job and 3 other jobs on the controller), one used by `ETL-API-CI`, and 2 referenced by no job configuration (possibly by another repository's `Jenkinsfile`; not verified) |
| Jenkins home              | `secrets/` is `0700 root` inside the container; the volume is mounted by `jenkins` and by `festive_elgamal`                                                                                                                                |

Consequences, in order of impact:

1. **Any logged-in Jenkins account is an administrator.** It can change `PARABANK_UAT_APPROVERS`,
   replay a `main` build with an edited `Jenkinsfile`, use the script console or read credentials.
   The UAT Approval is only as strong as the set of accounts that can log in. Reproduced in the
   matrix drill: an ordinary logged-in account reaches Manage Jenkins and the script console.
2. **The Jenkins approval does not cover Docker access.** Anyone who can run Docker on this machine
   can deploy or remove UAT directly. Today that is the owner's Windows account only
   (`docker-users`); the npm commands are conveniences, not a boundary. `npm run uat:deploy` is for
   the owner's documented rollback only ([docs/ci-cd.md](ci-cd.md#failure-rollback-and-recovery)).
3. **The pre-upgrade backup and the two rollback volumes are not encrypted** (Proposal 2).
4. **A stopped leftover container holds the Jenkins home and the Docker socket.** `festive_elgamal`
   (image `cypress/included:15.8.2`, command `cat`, created 2026-09-23, exited) is a build-agent
   container of another job; it mounts `jenkins_jenkins_home` read-write and the Docker socket.
   Stopped, it does nothing; started, it would expose the credentials and the daemon. Removing the
   container (not the volume) closes this path (Proposal 3).

## Proposal 1: Jenkins matrix authorization (owner approval required)

The `matrix-auth` plugin (3.3) is installed. The exact block proposed for `config.xml` is
[`scripts/ci/tests/matrix-auth-drill/matrix-strategy.xml`](../scripts/ci/tests/matrix-auth-drill/matrix-strategy.xml):

| Who                 | Permissions                              | Why                                                                                                                              |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `viamerico` (owner) | Overall/Administer                       | Administers Jenkins and approves UAT                                                                                             |
| `admin`             | Overall/Read (recommended); not disabled | Can still log in; can no longer administer or approve. Owner decision: keep Administer as an emergency account, or remove later  |
| `noreply`           | none                                     | Cannot log in                                                                                                                    |
| Authenticated users | Overall/Read, Job/Read                   | Future accounts can view; no Configure, Build, Replay, script console or credentials                                             |
| Anonymous           | none                                     | Unchanged (already denied)                                                                                                       |
| GitHub integration  | none                                     | Uses the GitHub App credential outbound; branch scans run as SYSTEM; no webhook user (GitHub cannot reach this loopback Jenkins) |
| Builds              | unchanged (SYSTEM)                       | Matrix authorization does not restrict what a build does; the Docker socket stays the boundary                                   |

A later non-administrator UAT approver needs Job/Read, Job/Build and Job/Cancel on this job and an
entry in `PARABANK_UAT_APPROVERS`; never Job/Configure or Run/Replay (they change the pipeline).

**Drilled** (`npm run test:matrix-auth`, 2026-10-14, throwaway Jenkins from the live image,
`--network none`, the real account IDs plus a plain `reader`, random passwords never printed): 22
checks, 0 failed. Today's model reproduced (a reader reaches Manage Jenkins and the script console);
backup and apply with the commands below; with the matrix: the owner administers, `admin` and the
reader read only, anonymous denied; a pipeline `input` limited to the owner (like UAT Approval)
refuses the reader and `admin` (HTTP 400, build still waiting) and completes for the owner;
rollback with the command below restores the previous model.

**Backup** (Jenkins running; `config.xml` changes only when saved; the live controller has no
`users/users.xml`, and user records are not changed by this proposal):

```sh
docker exec jenkins cp /var/jenkins_home/config.xml /var/jenkins_home/config.xml.bak-<date>-before-matrix
```

**Apply** (either way): Manage Jenkins → Security → Authorization → Matrix-based security, entering
the permissions of the table (add `viamerico` with Administer **before** saving; keep a second
browser session logged in as `viamerico` while saving); or, with Jenkins stopped, replace the
`<authorizationStrategy>` block of `config.xml` with the drilled block and start it again (what the
drill does). **Verify:** `viamerico` sees Manage Jenkins; `admin` logs in read-only; anonymous still
gets 403; the next PR build still reports both GitHub checks; the next `main` build stops at UAT
Approval and `viamerico` can answer it.

**Rollback / lockout recovery** (drilled; `docker start`, not `compose up`, which would recreate
the container):

```sh
docker stop jenkins
docker run --rm --network none --user 0 --entrypoint cp -v jenkins_jenkins_home:/var/jenkins_home jenkins-jenkins:latest -p /var/jenkins_home/config.xml.bak-<date>-before-matrix /var/jenkins_home/config.xml
docker start jenkins
```

Then confirm the previous `<authorizationStrategy>` in `config.xml` and log in.

## Proposal 2: backups and rollback volumes (owner approval required)

| Asset                                                                    | State (2026-10-14)                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `C:\JenkinsBackups\2026-10-11-pre-2.580.1\jenkins_home.tar.gz` (1.16 GB) | Intact (SHA-256 equals the recorded `f9ff5bde…`; gzip test OK); access: Administrators, SYSTEM and the owner's account; **not encrypted** (no EFS; BitLocker status needs an elevated prompt: `manage-bde -status C:`) |
| Volumes `jenkins_jenkins_home_pre2580`, `jenkins_jenkins_home_pre2580_b` | 4.8 GB each, used by no container; full copies of the Jenkins home taken for the upgrade                                                                                                                               |

All three contain `secrets/master.key` and `secrets/hudson.util.Secret` together with
`credentials.xml` and the user records with password hashes: the stored credentials can be
decrypted from any of them. They exist to roll back the 2.580.1 upgrade of 2026-10-12, which has
since run 18 real builds.

Recommended: keep **one** encrypted copy, remove the plain ones.

1. Encrypt (the passphrase is the owner's alone, typed at the prompt, kept outside this machine;
   OpenSSL is part of Git for Windows; the plain file is not changed):

   ```sh
   cd /c/JenkinsBackups/2026-10-11-pre-2.580.1
   openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in jenkins_home.tar.gz -out jenkins_home.tar.gz.enc
   ```

2. Verify without writing plaintext anywhere (must print the recorded SHA-256):

   ```sh
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in jenkins_home.tar.gz.enc | sha256sum
   cat jenkins_home.tar.gz.sha256
   ```

3. Only after step 2 matches: delete `jenkins_home.tar.gz` (irreversible), and, once the owner
   closes the upgrade's rollback window, `docker volume rm jenkins_jenkins_home_pre2580
jenkins_jenkins_home_pre2580_b` (irreversible; the encrypted archive remains the rollback).

The procedure was drilled on a synthetic 20 MB file: decryption to a stream reproduced the SHA-256,
a wrong passphrase was rejected. AES-CBC has no built-in integrity check, so step 2's SHA-256
comparison is the integrity check. **Restore:** decrypt to a file, then extract into a stopped
controller's volume as in the upgrade runbook (`C:\JenkinsUpgrade\2.580.1\UPGRADE.md`).

## Proposal 3: Docker clean-up (owner approval required)

Measured with `docker system df -v` on 2026-10-14. Never touched: the `jenkins`, QA and UAT
containers; the images they run (`c501f9abd72c`, `ce686b9276fa`); the current build-agent image
`d0a0a0b037e8`; the volume `jenkins_jenkins_home`.

| Item                                                                           | Reclaimable                                           | Proposal and check                                                                                                                     |
| ------------------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Container `festive_elgamal` (other job's leftover agent; see consequence 4)    | security, not space                                   | `docker rm festive_elgamal` (no `-v`: the Jenkins volume stays). **Recommended first.**                                                |
| Container `parabank-dev-parabank-1` (retired DEV, exited 137, no volumes)      | negligible                                            | `docker rm parabank-dev-parabank-1`                                                                                                    |
| 13 superseded build-agent images (`<40-hex>:latest`, 8 days old, no container) | ~36 kB (their layers are shared with the current one) | Tag clutter only: `docker image rm <id>` each; check first `docker ps -a --filter ancestor=<id> -q` is empty                           |
| Anonymous volume `ffffde9a97dd…` (56 KB, 2026-10-05, no container, no secrets) | 56 KB                                                 | `docker volume rm ffffde9a97dd0cfca3cb7872bf2073c32eb769acba13530d4550af63f06c6210`                                                    |
| `parabank-jenkins-candidate:2.580.1` (upgrade staging image)                   | 223 MB                                                | `docker image rm parabank-jenkins-candidate:2.580.1`                                                                                   |
| `jenkins-jenkins:2.541.2-rollback`                                             | 572 MB                                                | Keep until the owner closes the upgrade's rollback window                                                                              |
| `parasoft/parabank:latest` (vendor image, used by the DEV container)           | 239 MB                                                | Owner decision (it is the baseline the source-built image was compared with, docs/qa-coverage.md)                                      |
| `cypress/included` `latest`, `15.8.2`, `13.6.0` (not this project)             | 13.4 GB                                               | Owner decision (`15.8.2` is used by `festive_elgamal`)                                                                                 |
| `main` #1 archived artifacts                                                   | -                                                     | **Resolved 2026-10-14:** the job's retention (last 20 builds) discarded `main` #1 when `main` reached #21; nothing was deleted by hand |

No `docker system prune`: it would also remove the rollback image and other projects' resources.
After any clean-up: `npm run env:identity`, `npm run qa:health`, `npm run uat:health`, and the
Jenkins login page.

## Not proposed

- **Removing the Docker socket from Jenkins, or a dedicated deployment agent:** the pipeline builds
  images and deploys QA and UAT on the host daemon by design, on a single-user workstation where
  the only Docker user is the owner. A socket proxy, a rootless daemon or a separate deployment
  agent with its own Docker access is a redesign (agent provisioning, image builds through the
  proxy, UAT on another daemon or host) and is only worth it if Jenkins ever builds untrusted code
  or more people get access. Matrix authorization (Proposal 1) removes the practical escalation
  path (any logged-in account administering Jenkins) at a fraction of the cost.
- **Code-level refusal of `uat:deploy`:** it cannot stop `docker compose`, so it would only add
  friction; the owner closed that change (#17). The boundary is account and Docker access.
