// One worker and no retries on every execution path (cucumber.js, playwright/global-setup.ts).
// Each cucumber.js case loads the real config in a fresh process, with that environment and
// command line, so nothing is cached between cases.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { FullConfig } from '@playwright/test';
import globalSetup from '../../../playwright/global-setup';

const ROOT = path.resolve(__dirname, '..', '..', '..');

/** Loads cucumber.js like cucumber-js does; returns the exit status and stderr. */
function loadConfig(env: Record<string, string>, args: string[] = []) {
  const clean = { ...process.env };
  delete clean.CUCUMBER_RETRY;
  delete clean.CUCUMBER_PARALLEL;
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      "const c = require('./cucumber.js'); process.stdout.write(JSON.stringify(c.full))",
      '--',
      ...args,
    ],
    { cwd: ROOT, env: { ...clean, ...env }, encoding: 'utf8' },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('cucumber.js refuses retries and extra workers', () => {
  it('loads with no override: one worker, no retries', () => {
    const run = loadConfig({});
    assert.equal(run.status, 0, run.stderr);
    const full = JSON.parse(run.stdout) as { parallel: number; retry: number };
    assert.deepEqual([full.parallel, full.retry], [1, 0]);
  });

  it('accepts the values Jenkins sets explicitly (CUCUMBER_PARALLEL=1, CUCUMBER_RETRY=0)', () => {
    assert.equal(loadConfig({ CUCUMBER_PARALLEL: '1', CUCUMBER_RETRY: '0' }).status, 0);
  });

  for (const [name, env, args, pattern] of [
    ['CUCUMBER_RETRY=2', { CUCUMBER_RETRY: '2' }, [], /CUCUMBER_RETRY 2 refused/],
    ['CUCUMBER_PARALLEL=4', { CUCUMBER_PARALLEL: '4' }, [], /CUCUMBER_PARALLEL 4 refused/],
    ['--retry 3', {}, ['--retry', '3'], /--retry 3 refused/],
    ['--retry=1', {}, ['--retry=1'], /--retry 1 refused/],
    ['--parallel 2', {}, ['--parallel', '2'], /--parallel 2 refused/],
  ] as const) {
    it(`refuses ${name}`, () => {
      const run = loadConfig({ ...env }, [...args]);
      assert.notEqual(run.status, 0, `${name} was accepted`);
      assert.match(run.stderr, pattern);
    });
  }

  it('allows the harmless forms --retry 0 and --parallel 1', () => {
    assert.equal(loadConfig({}, ['--retry', '0']).status, 0);
    assert.equal(loadConfig({}, ['--parallel', '1']).status, 0);
  });

  it('refuses a real cucumber-js run with --retry (end to end, dry run)', () => {
    const run = spawnSync(
      process.execPath,
      [
        path.join('node_modules', '@cucumber', 'cucumber', 'bin', 'cucumber.js'),
        '--profile',
        'smoke',
        '--dry-run',
        '--retry',
        '2',
      ],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, REPORTS_DIR: 'reports/.retry-guard' } },
    );
    assert.notEqual(run.status, 0, 'cucumber-js accepted --retry 2');
    assert.match(`${run.stdout}${run.stderr}`, /--retry 2 refused/);
  });
});

describe('playwright/global-setup.ts refuses retries and extra workers', () => {
  const config = (workers: number, retries: number[]) =>
    ({ workers, projects: retries.map((r) => ({ retries: r })) }) as unknown as FullConfig;

  it('refuses --retries (any project with retries)', () => {
    assert.throws(() => globalSetup(config(1, [2])), /Refusing to run with retries 2/);
    assert.throws(() => globalSetup(config(1, [0, 1])), /Refusing to run with retries/);
  });

  it('still refuses extra workers first', () => {
    assert.throws(() => globalSetup(config(2, [0])), /Refusing to run with 2 workers/);
  });
});
