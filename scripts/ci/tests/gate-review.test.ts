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
    reviewedAtHead: (reviews: unknown, headSha: unknown, phrase?: string) => boolean | undefined;
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
      'jenkins/parabank-serial-queue-plugin/src/main/java/io/github/vassilva/parabank/SerialQueueDispatcher.java',
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

describe('review signal bound to the head commit (reviewedAtHead)', () => {
  const HEAD = 'a'.repeat(40);
  const OLD = 'b'.repeat(40);
  // Shaped like GET /repos/{owner}/{repo}/pulls/{n}/reviews (fields the guard relies on).
  const review = (fields: Record<string, unknown> = {}) => ({
    user: { login: 'owner' },
    author_association: 'OWNER',
    state: 'COMMENTED',
    commit_id: HEAD,
    body: 'Checked the Jenkinsfile change.\ngate-reviewed',
    ...fields,
  });

  it('accepts an owner Comment review of exactly the head commit with the phrase line', async () => {
    const { reviewedAtHead } = await load();
    assert.equal(reviewedAtHead([review()], HEAD), true);
  });

  it('never lets a review of an older commit authorize a newer one (stale review)', async () => {
    const { reviewedAtHead } = await load();
    assert.equal(reviewedAtHead([review({ commit_id: OLD })], HEAD), false);
  });

  it('ignores reviews without the exact phrase on its own line', async () => {
    const { reviewedAtHead } = await load();
    for (const body of ['', 'looks fine', 'not gate-reviewed yet', 'gate-reviewed-later', null]) {
      assert.equal(reviewedAtHead([review({ body })], HEAD), false, JSON.stringify(body));
    }
  });

  it('ignores reviewers who are not the repository owner', async () => {
    const { reviewedAtHead } = await load();
    for (const author_association of ['COLLABORATOR', 'CONTRIBUTOR', 'NONE', 'MEMBER']) {
      assert.equal(reviewedAtHead([review({ author_association })], HEAD), false);
    }
  });

  it('ignores dismissed, pending and change-request reviews', async () => {
    const { reviewedAtHead } = await load();
    for (const state of ['DISMISSED', 'PENDING', 'CHANGES_REQUESTED']) {
      assert.equal(reviewedAtHead([review({ state })], HEAD), false, state);
    }
  });

  it('a valid review among others still counts; none at all does not', async () => {
    const { reviewedAtHead } = await load();
    assert.equal(reviewedAtHead([review({ commit_id: OLD }), review()], HEAD), true);
    assert.equal(reviewedAtHead([], HEAD), false);
  });

  it('is unknown (fail closed) for unreadable reviews or head', async () => {
    const { reviewedAtHead, decideGateReview } = await load();
    for (const [reviews, head] of [
      [null, HEAD],
      [{}, HEAD],
      [[review()], ''],
      [[review()], 'not-a-sha'],
      [[review()], undefined],
    ]) {
      const reviewed = reviewedAtHead(reviews, head);
      assert.equal(reviewed, undefined);
      const d = decideGateReview({
        gateDefining: true,
        reviewed,
        autoMergeEnabled: false,
        jenkinsPassed: true,
        label,
      });
      assert.equal(d.state, 'failure');
    }
  });

  it('passing CI alone never counts as a review', async () => {
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
});

describe('guard and dispatch workflows (static checks)', () => {
  const guard = readFileSync('.github/workflows/gate-guard.yml', 'utf8');
  const dispatch = readFileSync('.github/workflows/gate-review-dispatch.yml', 'utf8');

  it('the guard decides from the reviews, not from the label', () => {
    assert.match(guard, /--reviewed-at-head/);
    assert.match(guard, /pulls\/\$pr\/reviews/);
    assert.doesNotMatch(guard, /reviewed=\$\(gh api "repos\/\$REPO\/issues\/\$pr\/labels"/);
  });

  it('the guard runs from main only (pull_request_target, status, workflow_dispatch)', () => {
    assert.match(guard, /pull_request_target:/);
    assert.doesNotMatch(guard, /^\s{2}pull_request:/m);
    assert.doesNotMatch(guard, /pull_request_review:/);
  });

  it('the dispatcher passes only the PR number to the guard on main, with actions: write only', () => {
    assert.match(
      dispatch,
      /gh workflow run gate-guard\.yml --repo "\$REPO" --ref main -f pr="\$PR"/,
    );
    assert.match(dispatch, /permissions:\s*\n\s*actions: write\s*\n\s*\n/);
    assert.doesNotMatch(dispatch, /statuses:|pull-requests:|contents: write|issues:/);
    assert.doesNotMatch(dispatch, /actions\/checkout/);
  });
});
