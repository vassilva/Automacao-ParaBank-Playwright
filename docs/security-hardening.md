# Security posture and hardening proposals

What protects the pipeline, the environments and the evidence today, verified on the real setup on
2026-10-13, and what is proposed. **Nothing in the "Proposals" sections is applied:** each one
changes live Jenkins, Docker or backup state and needs the repository owner's explicit approval.
Test-evidence protection (redaction, screenshots, traces) is described in the
[README](../README.md#security-approach) and [docs/ci-cd.md](ci-cd.md#reporting-and-evidence).

## Who can change what (verified 2026-10-13)

| Control                   | Current state                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merge into `main`         | Pull request required; checks `Jenkins` and `continuous-integration/jenkins/pr-head` required, branch up to date; no bypass actors; auto-merge disabled; the owner is the only collaborator                                                |
| Builds of untrusted code  | Jenkins discovers branches and pull requests of this repository only (no fork pull requests); a PR build runs that PR's own `Jenkinsfile`, so push access is what this trusts                                                              |
| UAT deployment in Jenkins | Only a `main` build, after QA Regression 24/24 and the UAT Approval input answered by a user in `PARABANK_UAT_APPROVERS` (checked again after the input)                                                                                   |
| UAT deployment outside    | `npm run uat:deploy` / `npm run env -- deploy uat <id>`, or `docker compose`, from any account that can use this machine's Docker daemon: **not covered by the Jenkins approval**                                                          |
| Jenkins authorization     | "Logged-in users can do anything"; anonymous read denied (HTTP 403); sign-up disabled; CSRF protection on; inbound agent port disabled                                                                                                     |
| Jenkins accounts          | `admin` and `viamerico` can log in (password set); `noreply` has no password (created from a commit author); no API tokens                                                                                                                 |
| Jenkins version           | 2.580.1 on Java 21; 0 update-center security warnings for the core and the 98 installed plugins                                                                                                                                            |
| Network exposure          | Jenkins `127.0.0.1:8080`, QA `127.0.0.1:8090`, UAT `127.0.0.1:8091`: loopback only                                                                                                                                                         |
| Jenkins process           | Runs as root in its container with the host Docker socket mounted (as does the build agent): Jenkins administration is Docker-host administration                                                                                          |
| Jenkins credentials       | 4 global credentials: the GitHub App credential (shared by this job and 3 other jobs on the controller), one used by `ETL-API-CI`, and 2 referenced by no job configuration (possibly by another repository's `Jenkinsfile`; not verified) |

Consequences, in order of impact:

1. **Any logged-in Jenkins account is an administrator.** It can change `PARABANK_UAT_APPROVERS`,
   replay a `main` build with an edited `Jenkinsfile`, use the script console or read credentials.
   The UAT Approval is only as strong as the set of accounts that can log in.
2. **The Jenkins approval does not cover Docker access.** Anyone who can run Docker on this machine
   can deploy or remove UAT directly. On this single-user workstation that is the owner's Windows
   account; the npm commands are conveniences, not a boundary. `npm run uat:deploy` is for the
   owner's documented rollback only ([docs/ci-cd.md](ci-cd.md#failure-rollback-and-recovery)).
3. **The pre-upgrade backup is not encrypted** (see "Backups").

## Proposal 1: Jenkins matrix authorization (owner approval required)

The `matrix-auth` plugin is installed. Proposed strategy: "Matrix-based security".

| Who                 | Permissions                                                                        | Why                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `viamerico` (owner) | Overall/Administer                                                                 | Administers Jenkins and approves UAT                                                                                             |
| `admin`             | Owner decision: emergency administrator with a strong, unique password, or removed | An unused administrator is the largest exposure                                                                                  |
| `noreply`           | none (or remove the user record)                                                   | Cannot log in                                                                                                                    |
| Authenticated users | Overall/Read, Job/Read                                                             | Future accounts can view; no Configure, Build, Replay, script console or credentials                                             |
| Anonymous           | none                                                                               | Unchanged (already denied)                                                                                                       |
| GitHub integration  | none                                                                               | Uses the GitHub App credential outbound; branch scans run as SYSTEM; no webhook user (GitHub cannot reach this loopback Jenkins) |
| Builds              | unchanged (SYSTEM)                                                                 | Matrix authorization does not restrict what a build does; the Docker socket stays the boundary                                   |

A later non-administrator UAT approver needs Job/Read, Job/Build and Job/Cancel on this job and an
entry in `PARABANK_UAT_APPROVERS`; never Job/Configure or Run/Replay (they change the pipeline).

**Backup** (Jenkins running; `config.xml` changes only when saved):

```sh
docker exec jenkins cp /var/jenkins_home/config.xml /var/jenkins_home/config.xml.bak-<date>-before-matrix
docker exec jenkins cp /var/jenkins_home/users/users.xml /var/jenkins_home/users/users.xml.bak-<date>-before-matrix
```

**Apply:** Manage Jenkins → Security → Authorization → Matrix-based security. Add `viamerico` with
Administer **before** saving; keep a second browser session logged in as `viamerico` while saving.
**Verify:** `viamerico` sees Manage Jenkins; another account sees jobs read-only; anonymous still
gets 403; the next PR build still reports both GitHub checks.

**Rollback / lockout recovery** (the restore command was drilled on a throwaway volume on
2026-10-14; `docker start`, not `compose up`, which would recreate the container):

```sh
docker stop jenkins
docker run --rm --network none --user 0 --entrypoint cp -v jenkins_jenkins_home:/var/jenkins_home   jenkins-jenkins:latest -p /var/jenkins_home/config.xml.bak-<date>-before-matrix /var/jenkins_home/config.xml
docker start jenkins
```

Then confirm the previous `<authorizationStrategy>` in `config.xml` and log in.

## Proposal 2: backups (owner approval required)

`C:\JenkinsBackups\2026-10-11-pre-2.580.1\jenkins_home.tar.gz` (1.16 GB) and the Docker volumes
`jenkins_jenkins_home_pre2580` and `jenkins_jenkins_home_pre2580_b` are full copies of the Jenkins
home taken for the 2.580.1 upgrade. They contain `secrets/master.key` and `secrets/hudson.util.Secret` together with `credentials.xml` (and the user records with password hashes), so the
stored credentials can be decrypted from them, and they are not encrypted. Options: encrypt the
archive (for example 7-Zip AES-256 with a passphrase kept outside this machine) and delete the
plain copy; and, once the owner closes the upgrade's rollback window, remove the two rollback
volumes. Deleting any of them is irreversible.

## Proposal 3: Docker clean-up (owner approval required)

| Item                                                      | State                                                                                                                    | Proposal                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 13 superseded Jenkins build-agent images (`<sha>:latest`) | 8 days old; no container uses them (verified 2026-10-14); the current agent image is `d0a0a0b037e8`                      | `docker image rm <id>` for each superseded ID                                                                         |
| `parabank-dev-parabank-1`                                 | Exited (137), retired DEV environment                                                                                    | Remove the container (its image may stay)                                                                             |
| `festive_elgamal` (`cypress/included`)                    | Exited (255), unrelated to this project                                                                                  | Owner decision                                                                                                        |
| `main` #1 archived artifacts                              | Synthetic usernames in its two archived container logs (archived before the log-redaction fix); its console log is clean | Delete build `main` #1 in Jenkins now, or let the job's retention (last 20 builds) discard it when `main` reaches #21 |

## Not proposed

- **Removing the Docker socket from Jenkins:** the pipeline builds images and deploys QA and UAT on
  the host daemon by design. Narrowing it (a socket proxy, a rootless daemon) is a redesign, not a
  hardening step, and is only worth it if Jenkins ever builds untrusted code.
- **Code-level refusal of `uat:deploy`:** it cannot stop `docker compose`, so it would only add
  friction; the owner closed that change (#17). The boundary is account and Docker access.
