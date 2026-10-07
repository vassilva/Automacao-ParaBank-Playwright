/**
 * Preconditions checked once, before any scenario runs.
 *
 * 1. One worker. ParaBank has a confirmed registration concurrency defect, so a command-line
 *    override such as --workers=4 is refused instead of silently producing false failures.
 * 2. The target is up and genuine, using the project's existing check (scripts/check-target.ts).
 *    A dead environment fails here once, as an infrastructure failure, instead of as 27
 *    ECONNREFUSED scenario failures. No retries or waits: an unavailable target is reported.
 */
import { spawnSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

export default function globalSetup(config: FullConfig): void {
  if (config.workers !== 1) {
    throw new Error(
      `Refusing to run with ${config.workers} workers: ParaBank's registration is not ` +
        'concurrency-safe, so this suite must run with exactly one worker.',
    );
  }

  const check = spawnSync(
    process.execPath,
    ['--require', 'ts-node/register', 'scripts/check-target.ts'],
    { stdio: 'inherit' },
  );
  if (check.status !== 0) {
    throw new Error(
      'TARGET UNAVAILABLE: the ParaBank target failed its health check (see above). ' +
        'This is an environment problem, not a test result; no scenario was executed.',
    );
  }
}
