# Security posture and hardening

What protects the pipeline, the environments and the evidence, verified on the real setup on
2026-10-14, and the hardening applied that day with the repository owner's explicit approval
(matrix authorization, encrypted backups, removal of a privileged leftover container). Test-evidence
protection (redaction, screenshots, traces, the evidence scan before publishing) is described in the
[README](../README.md#security-approach) and [docs/ci-cd.md](ci-cd.md#reporting-and-evidence).

## Who can change what (verified 2026-10-14, after the changes)

| Control                   | Current state                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merge into `main`         | Pull request required; checks `Jenkins` and `continuous-integration/jenkins/pr-head` required, branch up to date; no bypass actors; auto-merge disabled; merged head branches deleted automatically; the owner is the only collaborator    |
| Builds of untrusted code  | Jenkins discovers branches and pull requests of this repository only (no fork pull requests); a PR build runs that PR's own `Jenkinsfile`, so push access is what this trusts                                                              |
| UAT deployment in Jenkins | Only a `main` build, after QA Regression 24/24 and the UAT Approval input answered by a user in `PARABANK_UAT_APPROVERS` (checked again after the input); `main` #13 to #22 were all approved by the owner                                 |
| UAT deployment outside    | `npm run uat:deploy` / `npm run env -- deploy uat <id>`, or `docker compose`, from any account that can use this machine's Docker daemon: **not covered by the Jenkins approval**; owner rollback tool only                                |
| Docker access             | The Windows group `docker-users` contains only the owner's account; containers that mount the Docker socket: `jenkins` and its build agents                                                                                                |
| Jenkins authorization     | **Global matrix (applied 2026-10-14 18:09Z):** `viamerico` Administer; `admin` and authenticated users Overall/Read + Job/Read; anonymous nothing (HTTP 403); sign-up disabled; CSRF protection on; inbound agent port disabled            |
| Jenkins accounts          | `admin` and `viamerico` can log in (password set); `noreply` has no password (created from a commit author); no API tokens                                                                                                                 |
| Jenkins version           | 2.580.1 on Java 21; 0 update-center security warnings for the core and the 98 installed plugins                                                                                                                                            |
| Network exposure          | Jenkins `127.0.0.1:8080`, QA `127.0.0.1:8090`, UAT `127.0.0.1:8091`: loopback only                                                                                                                                                         |
| Jenkins process           | Runs as root in its container with the host Docker socket mounted (as does the build agent): Jenkins administration is Docker-host administration                                                                                          |
| Jenkins credentials       | 4 global credentials: the GitHub App credential (shared by this job and 3 other jobs on the controller), one used by `ETL-API-CI`, and 2 referenced by no job configuration (possibly by another repository's `Jenkinsfile`; not verified) |
| Jenkins home              | `secrets/` is `0700 root` inside the container; the volume is mounted by `jenkins` only                                                                                                                                                    |
| Backups                   | Encrypted only (AES-256-CBC, PBKDF2 600,000 iterations); the key is held by the owner (see "Backups")                                                                                                                                      |

Remaining exposure, accepted by design: whoever can run Docker on this machine (today only the
owner's Windows account) can change UAT without the Jenkins approval, and Jenkins administration is
Docker-host administration. See "Not proposed".

## Jenkins matrix authorization (applied 2026-10-14)

The applied block is exactly
[`scripts/ci/tests/matrix-auth-drill/matrix-strategy.xml`](../scripts/ci/tests/matrix-auth-drill/matrix-strategy.xml):

| Who                 | Permissions            | Why                                                                                                                              |
| ------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `viamerico` (owner) | Overall/Administer     | Administers Jenkins and approves UAT                                                                                             |
| `admin`             | Overall/Read, Job/Read | Can still log in (not disabled); can no longer administer or approve                                                             |
| `noreply`           | Overall/Read, Job/Read | As any authenticated account; it has no password, so it cannot log in                                                            |
| Authenticated users | Overall/Read, Job/Read | Can view; no Configure, Build, Replay, script console or credentials                                                             |
| Anonymous           | none                   | HTTP 403                                                                                                                         |
| GitHub integration  | none needed            | Uses the GitHub App credential outbound; branch scans run as SYSTEM; no webhook user (GitHub cannot reach this loopback Jenkins) |
| Builds              | unchanged (SYSTEM)     | Matrix authorization does not restrict what a build does; the Docker socket stays the boundary                                   |

A later non-administrator UAT approver needs Job/Read, Job/Build and Job/Cancel on this job and an
entry in `PARABANK_UAT_APPROVERS`; never Job/Configure or Run/Replay (they change the pipeline).

**How it was applied** (drilled first: `npm run test:matrix-auth`, 22 checks, 0 failed, including
the rollback): `config.xml` backed up in the volume as `config.xml.bak-2026-10-14-before-matrix`;
Jenkins stopped at 18:01:23Z with no build running; a consistent encrypted backup of the whole
Jenkins home taken (see "Backups"); the `<authorizationStrategy>` block replaced with the drilled
block; Jenkins started at 18:09:41Z.

**Verified after the change:** `config.xml` holds the global matrix with exactly the four
permissions and is otherwise identical to the backup; Jenkins fully up, no SEVERE log entry;
anonymous HTTP 403 on `/`, `/script`, `/manage/` and the job; GitHub branch scans after the restart
ended SUCCESS. **Pending:** the owner's own login check (`viamerico` administers and can answer UAT
Approval; `admin` is read-only); the repository has no credentials to log in as those accounts.

**Rollback / lockout recovery** (drilled; `docker start`, not `compose up`, which would recreate
the container):

```sh
docker stop jenkins
docker run --rm --network none --user 0 --entrypoint cp -v jenkins_jenkins_home:/var/jenkins_home jenkins-jenkins:latest -p /var/jenkins_home/config.xml.bak-<date>-before-matrix /var/jenkins_home/config.xml
docker start jenkins
```

For this change `<date>` is `2026-10-14`. Then confirm the previous `<authorizationStrategy>` in
`config.xml` and log in. The same backup command applies to any later authorization change:

```sh
docker exec jenkins cp /var/jenkins_home/config.xml /var/jenkins_home/config.xml.bak-<date>-before-matrix
```

## Backups (encrypted 2026-10-14)

| Backup                                                                       | Content                                                        | Plaintext SHA-256 (recorded) |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- |
| `C:\JenkinsBackups\2026-10-14-pre-matrix\jenkins_home.tar.gz.enc` (1.14 GB)  | The whole Jenkins home, taken with Jenkins stopped (2.580.1)   | `05933a91…` (`.sha256` file) |
| `C:\JenkinsBackups\2026-10-11-pre-2.580.1\jenkins_home.tar.gz.enc` (1.16 GB) | The Jenkins home before the 2.580.1 upgrade (2.541.2 rollback) | `f9ff5bde…` (`.sha256` file) |

Both contain `secrets/master.key`, `secrets/hudson.util.Secret`, `credentials.xml`, `config.xml`,
the user records and all five jobs (checked by listing them through decryption, nothing written).
**Key:** a random 256-bit key generated on 2026-10-14 into
`C:\Users\LENOVO\JenkinsBackupKey\jenkins-backup.key` (ACL: the owner's account only), never
displayed or logged; the owner has copied it to an independent location. Without the key the
backups cannot be restored.

**Recovery proven:** the pre-upgrade backup was restored into a throwaway Jenkins
(`jenkins-jenkins:2.541.2-rollback`, `--network none`, removed afterwards): Jenkins 2.541.2 started
with 38 jobs (5 top-level), the four users and the four credentials; every stored secret decrypted
(the GitHub App's `getPassword` asks GitHub for a live token and cannot work offline; its stored
private key decrypted). Both encrypted files decrypt to their recorded SHA-256, and the decrypted
stream passes the gzip test.

**Removed with the owner's approval** (after both checks passed again and the owner confirmed the
key copy): the plaintext `C:\JenkinsBackups\2026-10-11-pre-2.580.1\jenkins_home.tar.gz` and the
volumes `jenkins_jenkins_home_pre2580` and `jenkins_jenkins_home_pre2580_b` (copies of the
pre-upgrade home; their jobs, history and credentials are in the 2026-10-14 backup, their plugin
and version state in the encrypted pre-upgrade archive).

**Make a new backup** (Jenkins stopped for consistency; no plaintext is written; run in Git Bash,
using a Windows-form path for OpenSSL's output):

```sh
docker stop jenkins
mkdir -p /c/JenkinsBackups/<date>
docker run --rm --network none --user 0 -v jenkins_jenkins_home:/jh:ro --entrypoint tar jenkins-jenkins:latest -czf - -C /jh . \
  | tee >(sha256sum | cut -c1-64 > /c/JenkinsBackups/<date>/jenkins_home.tar.gz.sha256) \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass file:C:/Users/LENOVO/JenkinsBackupKey/jenkins-backup.key -out C:/JenkinsBackups/<date>/jenkins_home.tar.gz.enc
docker start jenkins
```

**Verify** (must print the recorded SHA-256; nothing is written):

```sh
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:C:/Users/LENOVO/JenkinsBackupKey/jenkins-backup.key -in C:/JenkinsBackups/<date>/jenkins_home.tar.gz.enc | sha256sum
cat /c/JenkinsBackups/<date>/jenkins_home.tar.gz.sha256
```

**Restore** (into a stopped controller, or a throwaway volume to test): decrypt to a stream and
extract into the volume, then start Jenkins (`docker start`, as root like the live controller):

```sh
docker stop jenkins
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:C:/Users/LENOVO/JenkinsBackupKey/jenkins-backup.key -in C:/JenkinsBackups/<date>/jenkins_home.tar.gz.enc \
  | docker run --rm -i --network none --user 0 -v jenkins_jenkins_home:/jh --entrypoint tar jenkins-jenkins:latest -xzf - -C /jh
docker start jenkins
```

The restore drill of 2026-10-14 extracted the same archive from a file (`tar -xzf <file>`); this
streamed form (decryption piped into `tar -xzf -`) was not run end to end, because extracting about
5 GB into Docker's disk did not fit the free space; its two halves (decryption to the recorded
SHA-256, extraction of that archive) were each verified.

AES-CBC has no built-in integrity check: the SHA-256 comparison is the integrity check. Disk C: was
99% used on 2026-10-14 (4.1 GB free after the clean-up); check `df -h /c` before a new backup
(about 1.2 GB each).

## Docker clean-up

Done 2026-10-14 with the owner's approval: `festive_elgamal` (a stopped leftover build-agent
container of another job that mounted `jenkins_jenkins_home` read-write and the Docker socket)
removed with `docker rm` (no `-v`); its configuration was recorded first; volumes and images were
unchanged by the removal. The two rollback volumes were removed as described in "Backups". `main`
#1's archived artifacts (synthetic usernames) were discarded by the job's retention.

Optional, owner decision (not security findings):

| Item                                                                      | Reclaimable            | Command                                                                              |
| ------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| Container `parabank-dev-parabank-1` (retired DEV, exited 137, no volumes) | negligible             | `docker rm parabank-dev-parabank-1`                                                  |
| 13 superseded build-agent images (`<40-hex>:latest`, no container)        | ~36 kB (layers shared) | `docker image rm <id>` each, after `docker ps -a --filter ancestor=<id> -q` is empty |
| Anonymous volume `ffffde9a97dd…` (56 KB, no container, no secrets)        | 56 KB                  | `docker volume rm ffffde9a97dd0cfca3cb7872bf2073c32eb769acba13530d4550af63f06c6210`  |
| `parabank-jenkins-candidate:2.580.1` (upgrade staging image)              | 223 MB                 | `docker image rm parabank-jenkins-candidate:2.580.1`                                 |
| `jenkins-jenkins:2.541.2-rollback`                                        | 572 MB                 | Keep while the encrypted pre-upgrade backup is the rollback                          |
| `parasoft/parabank:latest` (vendor image, used by the DEV container)      | 239 MB                 | Owner decision (baseline of the source-built image, docs/qa-coverage.md)             |
| `cypress/included` `latest`, `15.8.2`, `13.6.0` (not this project)        | 13.4 GB                | Owner decision; the largest reclaimable space on a 99%-full disk                     |

No `docker system prune`: it would also remove the rollback image and other projects' resources.
Removing volumes or images does not shrink Docker Desktop's disk image on its own. After any
clean-up: `npm run env:identity`, `npm run qa:health`, `npm run uat:health`, and the Jenkins login
page.

## Not proposed

- **Removing the Docker socket from Jenkins, or a dedicated deployment agent:** the pipeline builds
  images and deploys QA and UAT on the host daemon by design, on a single-user workstation where
  the only Docker user is the owner. A socket proxy, a rootless daemon or a separate deployment
  agent with its own Docker access is a redesign (agent provisioning, image builds through the
  proxy, UAT on another daemon or host) and is only worth it if Jenkins ever builds untrusted code
  or more people get access. Matrix authorization removed the practical escalation path (any
  logged-in account administering Jenkins) at a fraction of the cost.
- **Code-level refusal of `uat:deploy`:** it cannot stop `docker compose`, so it would only add
  friction; the owner closed that change (#17). The boundary is account and Docker access.
