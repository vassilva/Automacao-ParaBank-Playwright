// Required "gate-review" status policy (.github/scripts/gate-review.mjs) and the real pattern list.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

type Decision = { state: 'success' | 'failure' | 'pending'; description: string };
type Input = {
  gateDefining?: boolean;
  reviewed?: boolean;
  autoMergeEnabled?: boolean;
  jenkinsPassed?: boolean;
};
const load = async () =>
  (await import('../../../.github/scripts/gate-review.mjs')) as {
    decideGateReview: (i: Input & { label: string }) => Decision;
    gateDefiningPaths: (patterns: string[], files: string[]) => string[];
  };
const label = 'gate-change-reviewed';

describe('gate-review decision', () => {
  it('ordinary PRs pass, so auto-merge stays available (Jenkins checks still gate them)', async () => {
    const { decideGateReview } = await load();
    for (const autoMergeEnabled of [true, false]) {
      for (const jenkinsPassed of [true, false]) {
        const d = decideGateReview({
          gateDefining: false,
          reviewed: false,
          autoMergeEnabled,
          jenkinsPassed,
          label,
        });
        assert.equal(d.state, 'success');
      }
    }
  });

  it('gate-defining PR with auto-merge enabled is blocked, even reviewed and green', async () => {
    const { decideGateReview } = await load();
    const d = decideGateReview({
      gateDefining: true,
      reviewed: true,
      autoMergeEnabled: true,
      jenkinsPassed: true,
      label,
    });
    assert.equal(d.state, 'failure');
    assert.match(d.description, /auto-merge not allowed/);
  });

  it('a label alone does not make a gate-defining PR mergeable before Jenkins passed', async () => {
    const { decideGateReview } = await load();
    const d = decideGateReview({
      gateDefining: true,
      reviewed: true,
      autoMergeEnabled: false,
      jenkinsPassed: false,
      label,
    });
    assert.equal(d.state, 'pending');
  });

  it('unreviewed gate-defining PR is blocked', async () => {
    const { decideGateReview } = await load();
    const d = decideGateReview({
      gateDefining: true,
      reviewed: false,
      autoMergeEnabled: false,
      jenkinsPassed: true,
      label,
    });
    assert.equal(d.state, 'failure');
  });

  it('reviewed, green, auto-merge off: success, the last signal, for a manual merge', async () => {
    const { decideGateReview } = await load();
    const d = decideGateReview({
      gateDefining: true,
      reviewed: true,
      autoMergeEnabled: false,
      jenkinsPassed: true,
      label,
    });
    assert.equal(d.state, 'success');
    assert.match(d.description, /merge manually/);
  });

  it('fails closed when any input could not be read (API or permission problem)', async () => {
    const { decideGateReview } = await load();
    const complete = {
      gateDefining: false,
      reviewed: false,
      autoMergeEnabled: false,
      jenkinsPassed: true,
    };
    for (const key of Object.keys(complete) as (keyof typeof complete)[]) {
      const input: Input = { ...complete };
      delete input[key];
      assert.equal(decideGateReview({ ...input, label }).state, 'failure', `missing ${key}`);
    }
  });
});

describe('gate-defining pattern list (.github/gate-defining-paths.json)', () => {
  const { patterns } = JSON.parse(readFileSync('.github/gate-defining-paths.json', 'utf8')) as {
    patterns: string[];
  };

  it('covers the Jenkinsfile, CI scripts, workflows, guard scripts and the ruleset file', async () => {
    const { gateDefiningPaths } = await load();
    const files = [
      'Jenkinsfile',
      'scripts/ci/app-image.ts',
      '.github/workflows/gate-guard.yml',
      '.github/scripts/gate-review.mjs',
      'docs/github-ruleset-main.json',
      'package.json',
    ];
    assert.deepEqual(gateDefiningPaths(patterns, files), files);
  });

  it('does not flag tests, features or documentation', async () => {
    const { gateDefiningPaths } = await load();
    const files = [
      'features/transfers/transfer-funds.feature',
      'src/pages/bill-pay.page.ts',
      'docs/ci-cd.md',
      'README.md',
    ];
    assert.deepEqual(gateDefiningPaths(patterns, files), []);
  });
});
