/**
 * Target/environment health check, run before any scenario.
 *
 *   npm run check:target            one-shot: is the configured ParaBank up and genuine?
 *   npm run check:target -- --wait  poll until ready, bounded by TARGET_WAIT_SECONDS (default 180)
 *
 * Readiness = the home page and the registration form are served with their expected content.
 * Polling sends one request every TARGET_POLL_SECONDS (default 3) and stops at the first success.
 */
import { edgeRejectionHint } from '../src/api/parabank-client';
import { config } from '../src/support/config';

const waitSeconds = Number(process.env.TARGET_WAIT_SECONDS ?? 180);
const pollSeconds = Number(process.env.TARGET_POLL_SECONDS ?? 3);
const shouldWait = process.argv.includes('--wait');

async function check(path: string, expectedText: string): Promise<void> {
  const url = new URL(path, config.baseURL);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await response.text();
  if (!response.ok || !body.includes(expectedText)) {
    const hint = edgeRejectionHint(response.status, Object.fromEntries(response.headers));
    throw new Error(
      `${url.pathname}: HTTP ${response.status}${hint}, expected content found: ${body.includes(expectedText)}`,
    );
  }
  console.log(`OK ${url.pathname} (HTTP ${response.status})`);
}

const describe = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: { code?: string } }).cause?.code;
  return cause ? `${error.message} (${cause})` : error.message;
};

async function waitUntilServing(): Promise<void> {
  const deadline = Date.now() + waitSeconds * 1000;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      await check('index.htm', 'Customer Login');
      console.log(`Ready after ${attempts} attempt(s)`);
      return;
    } catch (error) {
      if (Date.now() + pollSeconds * 1000 > deadline) {
        throw new Error(
          `not ready after ${waitSeconds}s (${attempts} attempts); last error: ${describe(error)}`,
          { cause: error },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
    }
  }
}

async function main(): Promise<void> {
  console.log(`Validating ParaBank target "${config.targetEnv}" at ${config.baseURL}`);
  if (shouldWait) await waitUntilServing();
  await check('index.htm', 'Customer Login');
  await check('register.htm', 'Signing up is easy!');
}

main().catch((error: unknown) => {
  console.error(`Target validation failed: ${describe(error)}`);
  console.error(
    `Is ${config.targetEnv.toUpperCase()} running? Check it with: npm run ${config.targetEnv}:status ` +
      `(deploy: npm run ${config.targetEnv}:deploy, start: npm run ${config.targetEnv}:start)`,
  );
  process.exit(1);
});
