/**
 * Playwright Test entry point for the Gherkin suite: one Playwright test per Cucumber scenario.
 *
 * The scenarios are NOT re-implemented here. Each test asks Cucumber to execute its feature-file
 * location, with the project's step definitions, World and hooks. Gherkin tags become Playwright
 * tags, so suites are selected with --grep exactly as Cucumber's tag filter would select them.
 * The scenario runs in Playwright Test's own `browser` fixture, so --headed, UI Mode (including
 * "Show browser") and Playwright's trace observe the real ParaBank session.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from '@playwright/test';
import { lendBrowser, lentBrowserWasUsed } from '../src/support/browser-host';
import { runScenario, type PlannedScenario, type ScenarioOutcome } from './cucumber-runtime';
import { judgeKnownDefect } from './known-defect-proofs';

function loadPlan(): PlannedScenario[] {
  const result = spawnSync(
    process.execPath,
    ['--require', 'ts-node/register', path.join(__dirname, 'plan-scenarios.ts')],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`Could not plan the Cucumber scenarios:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as PlannedScenario[];
}

/**
 * A scenario that states the CORRECT behavior for a confirmed product defect (docs/defects.md).
 * Its assertions are never relaxed. It is judged by playwright/known-defect-proofs.ts:
 * - it fails through the defect's registered proof: expected failure, reported as such;
 * - it fails any other way (setup, action, hook, transport, timeout, undefined/pending step, or
 *   an assertion that is not the proof): a real failure, the defect was not demonstrated;
 * - it passes: a failure too, because the defect no longer reproduces and must be reclassified.
 */
const KNOWN_DEFECT = '@known-defect';

function judgeScenario(scenario: PlannedScenario, location: string, outcome: ScenarioOutcome) {
  const defects = scenario.tags.filter((tag) => /^@PB-\d+$/.test(tag)).map((tag) => tag.slice(1));
  const [id] = defects;
  if (!id || defects.length !== 1) {
    throw new Error(`Known-defect scenario ${location} must carry exactly one @PB-xx tag`);
  }
  const judgment = judgeKnownDefect(id, outcome);
  if (judgment.verdict === 'no-longer-reproduces') {
    throw new Error(
      `${id} no longer reproduces (${location}): verify the fix, remove @known-defect and ` +
        'classify the scenario into its suites.',
    );
  }
  if (judgment.verdict === 'not-the-defect') {
    throw new Error(
      `Known-defect scenario did not fail through the proof of ${id} (${location}): ` +
        `${judgment.reason}.\n\n${outcome.failure ?? ''}`,
    );
  }
  test.info().annotations.push({
    type: 'known-defect',
    description: `${id} reproduced (${judgment.check})`,
  });
  test.fail();
  throw new Error(
    `${id} reproduced through "${judgment.check}" (${location})\n\n${outcome.failure}`,
  );
}

const plan = loadPlan();
const features = [...new Set(plan.map((scenario) => scenario.uri))];

for (const uri of features) {
  const scenarios = plan.filter((scenario) => scenario.uri === uri);
  test.describe(scenarios[0]?.feature ?? uri, () => {
    for (const scenario of scenarios) {
      const location = `${scenario.uri}:${scenario.line}`;
      test(
        // The location keeps titles unique (Outline examples can share a name) and traceable.
        `${scenario.name} (${location})`,
        { tag: scenario.tags, annotation: { type: 'scenario', description: location } },
        async ({ browser }) => {
          lendBrowser(browser);
          const outcome = await runScenario(scenario);
          const usedLentBrowser = lentBrowserWasUsed();
          lendBrowser(undefined);
          for (const attachment of outcome.attachments) {
            await test.info().attach(attachment.name, {
              body: attachment.body,
              contentType: attachment.contentType,
            });
          }
          await test.info().attach('cucumber-summary', {
            body: outcome.summary,
            contentType: 'text/plain',
          });
          if (!usedLentBrowser) {
            throw new Error('Cucumber launched its own browser instead of the Playwright Test one');
          }
          if (outcome.executed !== 1) {
            throw new Error(
              `Cucumber executed ${outcome.executed} scenario(s) for ${location}, expected exactly 1`,
            );
          }
          if (scenario.tags.includes(KNOWN_DEFECT)) {
            judgeScenario(scenario, location, outcome);
          } else if (outcome.status !== 'PASSED') {
            throw new Error(`Scenario failed in Cucumber (${location})\n\n${outcome.failure}`);
          }
        },
      );
    }
  });
}
