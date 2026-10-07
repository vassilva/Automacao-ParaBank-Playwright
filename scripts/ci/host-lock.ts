/**
 * Host-wide mutex for ParaBank pipeline stages on one Docker host.
 *
 *   ts-node scripts/ci/host-lock.ts acquire <owner>
 *   ts-node scripts/ci/host-lock.ts release <owner>
 *
 * Why: two pipelines building and testing ParaBank at the same time exhaust the lab's Docker VM
 * (3.7 GiB): every smoke step timed out although names and ports never collided. Jenkins' own
 * disableConcurrentBuilds() only covers one branch/PR job, and no locking plugin is installed.
 *
 * How: creating a Docker network is atomic in the daemon, so the build that creates
 * "parabank-ci-host-lock" holds the lock. Labels record the owner (Jenkins BUILD_TAG) and the time.
 * Waiters poll at a fixed interval, bounded by PARABANK_LOCK_WAIT_MINUTES (default 60), and name
 * the holder. A lock older than PARABANK_LOCK_STALE_MINUTES (default 150, longer than any stage
 * timeout) can only belong to a build that died without its post section; it is removed loudly.
 * release is idempotent and only removes a lock held by the given owner.
 */
import { spawnSync } from 'node:child_process';

const LOCK = 'parabank-ci-host-lock';
const OWNER_LABEL = 'parabank.lock.owner';
const SINCE_LABEL = 'parabank.lock.since';
const POLL_SECONDS = 15;

function docker(args: string[]) {
  return spawnSync('docker', args, { encoding: 'utf8' });
}

function holder(): { owner: string; since: number } | undefined {
  const result = docker(['network', 'inspect', LOCK, '--format', '{{json .Labels}}']);
  if (result.status !== 0) return undefined;
  const labels = JSON.parse(result.stdout.trim() || '{}') as Record<string, string>;
  return { owner: labels[OWNER_LABEL] ?? 'unknown', since: Number(labels[SINCE_LABEL] ?? 0) };
}

function tryCreate(owner: string): boolean {
  const since = Math.floor(Date.now() / 1000).toString();
  return (
    docker([
      'network',
      'create',
      '--internal',
      '--label',
      `${OWNER_LABEL}=${owner}`,
      '--label',
      `${SINCE_LABEL}=${since}`,
      LOCK,
    ]).status === 0
  );
}

const minutes = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

async function acquire(owner: string): Promise<void> {
  const waitMinutes = minutes(process.env.PARABANK_LOCK_WAIT_MINUTES, 60);
  const staleMinutes = minutes(process.env.PARABANK_LOCK_STALE_MINUTES, 150);
  const deadline = Date.now() + waitMinutes * 60_000;
  for (let reported = ''; ;) {
    if (tryCreate(owner)) {
      console.log(`HOST LOCK acquired by ${owner}`);
      return;
    }
    const current = holder();
    if (current?.owner === owner) {
      console.log(`HOST LOCK already held by ${owner}`);
      return;
    }
    if (current) {
      const ageMinutes = (Date.now() / 1000 - current.since) / 60;
      if (ageMinutes > staleMinutes) {
        console.log(
          `HOST LOCK held by ${current.owner} for ${Math.round(ageMinutes)} min (> ${staleMinutes}): ` +
            'treated as stale (its build ended without releasing it); removing it.',
        );
        docker(['network', 'rm', LOCK]);
        continue;
      }
      if (reported !== current.owner) {
        console.log(
          `Waiting for the host lock held by ${current.owner} (up to ${waitMinutes} min)`,
        );
        reported = current.owner;
      }
    }
    if (Date.now() + POLL_SECONDS * 1000 > deadline) {
      throw new Error(
        `Host lock not acquired within ${waitMinutes} min (held by ${current?.owner ?? 'unknown'})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  }
}

function release(owner: string): void {
  const current = holder();
  if (!current) {
    console.log('HOST LOCK not held by anyone; nothing to release');
    return;
  }
  if (current.owner !== owner) {
    console.log(`HOST LOCK held by ${current.owner}, not by ${owner}; left untouched`);
    return;
  }
  if (docker(['network', 'rm', LOCK]).status !== 0) {
    throw new Error(`Could not remove the host lock ${LOCK}`);
  }
  console.log(`HOST LOCK released by ${owner}`);
}

const [command, owner] = process.argv.slice(2);
(async () => {
  if (!owner) throw new Error('Usage: host-lock.ts acquire|release <owner>');
  if (command === 'acquire') await acquire(owner);
  else if (command === 'release') release(owner);
  else throw new Error(`Unknown command "${command}"`);
})().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
