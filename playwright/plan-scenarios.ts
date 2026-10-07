/**
 * Prints the full suite's scenario plan as JSON, from a Cucumber dry run.
 *
 * Playwright collects tests synchronously, while Cucumber's API is asynchronous, so the spec runs
 * this script as a child process. Nothing is generated on disk: the plan is recomputed from the
 * .feature files on every run and therefore cannot drift from them.
 */
import { planScenarios } from './cucumber-runtime';

planScenarios()
  .then((plan) => process.stdout.write(JSON.stringify(plan)))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
