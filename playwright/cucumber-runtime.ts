/**
 * Thin adapter between Playwright Test and Cucumber's official programmatic API
 * (@cucumber/cucumber/api). It holds no test logic: the scenarios are the .feature files and they
 * are executed by Cucumber with the project's own configuration (cucumber.js), support code,
 * World, hooks and step definitions, exactly as `cucumber-js` would run them.
 */
import { PassThrough } from 'node:stream';
import {
  loadConfiguration,
  runCucumber,
  type IRunConfiguration,
  type ISupportCodeLibrary,
} from '@cucumber/cucumber/api';
import {
  AttachmentContentEncoding,
  TestStepResultStatus,
  type Envelope,
  type Pickle,
} from '@cucumber/messages';
import { redact } from '../src/support/redaction';

/** A Gherkin scenario (one Cucumber pickle), as Cucumber itself compiled it. */
export interface PlannedScenario {
  /** Feature file, relative and with forward slashes, e.g. features/accounts/accounts.feature */
  uri: string;
  /** Line of the Scenario, or of the Examples row for a Scenario Outline. */
  line: number;
  name: string;
  feature: string;
  /** Effective tags (feature + rule + scenario + examples), as Cucumber's tag filter sees them. */
  tags: string[];
}

export type StepKind = 'Context' | 'Action' | 'Outcome' | 'Hook' | 'Unknown';

/** What Cucumber reported for one test step (hooks included), in execution order. */
export interface StepResult {
  kind: StepKind;
  /** Cucumber's status: PASSED, FAILED, SKIPPED, UNDEFINED, PENDING, AMBIGUOUS or UNKNOWN. */
  status: string;
  /** Constructor name of the thrown error (Cucumber's exception.type), when one was thrown. */
  exceptionType?: string;
  /** Redacted message of the thrown error. */
  exceptionMessage?: string;
}

export interface ScenarioOutcome {
  /** Number of test cases Cucumber executed for the requested location (must be exactly 1). */
  executed: number;
  status: 'PASSED' | 'FAILED';
  /** Human-readable reason for a non-passed scenario: failing step and Cucumber's message. */
  failure?: string;
  /** Every step and hook result: Gherkin Given (Context), When (Action), Then (Outcome). */
  steps: StepResult[];
  /** Cucumber attachments (failure screenshot, failing page, edge-proxy notes). */
  attachments: { name: string; contentType: string; body: Buffer }[];
  /** Cucumber's own summary of the run. */
  summary: string;
}

function silentEnvironment() {
  const stdout = new PassThrough();
  let summary = '';
  stdout.on('data', (chunk: Buffer) => (summary += chunk.toString('utf8')));
  return {
    environment: { cwd: process.cwd(), stdout, stderr: process.stderr, env: process.env },
    summary: () => summary,
  };
}

/**
 * The project's Cucumber configuration, adapted for being driven one scenario at a time from
 * inside a Playwright worker:
 * - no tag filter: the plan holds every scenario, known-defect ones included (the spec decides how
 *   each one is judged, and Playwright's --grep selects suites);
 * - in-process (parallel 0): Playwright owns scheduling, and its single worker is the only one;
 * - no retries: a flaky scenario must be visible, as in the native runner;
 * - no Cucumber report files: each call would overwrite them; Playwright reports the run.
 */
async function bridgeConfiguration(environment: object): Promise<IRunConfiguration> {
  const { runConfiguration } = await loadConfiguration({ profiles: ['full'] }, environment);
  return {
    ...runConfiguration,
    sources: { ...runConfiguration.sources, tagExpression: '' },
    runtime: { ...runConfiguration.runtime, parallel: 0, retry: 0, failFast: false },
    formats: { ...runConfiguration.formats, stdout: 'summary', files: {}, publish: false },
  };
}

/** Every scenario of the full suite, from a Cucumber dry run (which also rejects undefined steps). */
export async function planScenarios(): Promise<PlannedScenario[]> {
  const { environment, summary } = silentEnvironment();
  const configuration = await bridgeConfiguration(environment);
  const features = new Map<string, string>();
  const pickles: Pickle[] = [];
  const result = await runCucumber(
    { ...configuration, runtime: { ...configuration.runtime, dryRun: true } },
    environment,
    (envelope: Envelope) => {
      if (envelope.gherkinDocument?.feature && envelope.gherkinDocument.uri) {
        features.set(envelope.gherkinDocument.uri, envelope.gherkinDocument.feature.name);
      }
      if (envelope.pickle) pickles.push(envelope.pickle);
    },
  );
  if (!result.success) throw new Error(`Cucumber dry run failed:\n${summary()}`);
  return pickles.map((pickle) => {
    if (!pickle.location) throw new Error(`Pickle without location: ${pickle.uri} ${pickle.name}`);
    return {
      uri: pickle.uri.replace(/\\/g, '/'),
      line: pickle.location.line,
      name: pickle.name,
      feature: features.get(pickle.uri) ?? pickle.uri,
      tags: pickle.tags.map((tag) => tag.name),
    };
  });
}

/** Loaded once per Playwright worker and reused, as Cucumber's API documents for serial runs. */
let support:
  Promise<{ configuration: IRunConfiguration; library?: ISupportCodeLibrary }> | undefined;

/** Runs exactly one scenario through Cucumber and reports what Cucumber observed. */
export async function runScenario(scenario: PlannedScenario): Promise<ScenarioOutcome> {
  const { environment, summary } = silentEnvironment();
  support ??= bridgeConfiguration(environment).then((configuration) => ({ configuration }));
  const loaded = await support;
  const { configuration } = loaded;

  const pickleSteps = new Map<string, { text: string; kind: StepKind }>();
  const testSteps = new Map<string, { label: string; kind: StepKind }>();
  const outcome: ScenarioOutcome = {
    executed: 0,
    status: 'PASSED',
    attachments: [],
    summary: '',
    steps: [],
  };
  const failures: string[] = [];

  const result = await runCucumber(
    {
      ...configuration,
      sources: { ...configuration.sources, paths: [`${scenario.uri}:${scenario.line}`] },
      support: loaded.library ?? configuration.support,
    },
    environment,
    (envelope: Envelope) => {
      if (envelope.pickle) {
        for (const step of envelope.pickle.steps) {
          const kind = (step.type === undefined ? 'Unknown' : String(step.type)) as StepKind;
          pickleSteps.set(step.id, { text: step.text, kind });
        }
      }
      if (envelope.testCase) {
        outcome.executed += 1;
        for (const step of envelope.testCase.testSteps) {
          const pickleStep = step.pickleStepId ? pickleSteps.get(step.pickleStepId) : undefined;
          testSteps.set(
            step.id,
            pickleStep
              ? { label: `Step "${pickleStep.text}"`, kind: pickleStep.kind }
              : { label: 'Hook', kind: 'Hook' },
          );
        }
      }
      const finished = envelope.testStepFinished;
      if (finished) {
        const { status, message, exception } = finished.testStepResult;
        const step = testSteps.get(finished.testStepId) ?? { label: 'Step', kind: 'Unknown' };
        outcome.steps.push({
          kind: step.kind,
          status: String(status),
          exceptionType: exception?.type,
          exceptionMessage: exception ? redact(exception.message ?? '') : undefined,
        });
        if (status !== TestStepResultStatus.PASSED && status !== TestStepResultStatus.SKIPPED) {
          failures.push(`${step.label}: ${status}${message ? `\n${message}` : ''}`);
        }
      }
      const attachment = envelope.attachment;
      if (attachment) {
        const base64 = attachment.contentEncoding === AttachmentContentEncoding.BASE64;
        outcome.attachments.push({
          name: attachment.mediaType.startsWith('image/') ? 'screenshot' : 'cucumber-note',
          contentType: attachment.mediaType,
          // Text is redacted again here (defense in depth); images are masked when captured.
          body: base64
            ? Buffer.from(attachment.body, 'base64')
            : Buffer.from(redact(attachment.body), 'utf8'),
        });
      }
    },
  );
  loaded.library ??= result.support;

  outcome.summary = redact(summary());
  if (!result.success || failures.length > 0) {
    outcome.status = 'FAILED';
    outcome.failure = redact(failures.join('\n\n') || 'Cucumber reported an unsuccessful run');
  }
  return outcome;
}
