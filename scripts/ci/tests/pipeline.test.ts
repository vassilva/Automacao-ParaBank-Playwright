// Pipeline order, gates and serialization, evaluated on the Jenkinsfile's own stage list and `when`
// expressions (pipeline-model) plus static checks of the Jenkinsfile.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { simulate } from './pipeline-model';

const src = readFileSync('Jenkinsfile', 'utf8');
const before = (ran: string[], a: string, b: string) => {
  assert.ok(ran.includes(a), `${a} ran`);
  assert.ok(ran.includes(b), `${b} ran`);
  assert.ok(ran.indexOf(a) < ran.indexOf(b), `${a} before ${b}`);
};
const UAT = ['UAT Promotion', 'Deploy UAT', 'UAT Ready', 'UAT Smoke', 'Deployment Record'];

describe('pull request (pre-merge)', () => {
  const run = simulate('feature/x', '7', { appImage: 'REUSE' });

  it('runs Quality Gates, then QA Smoke (4), before the PR can pass', () => {
    assert.equal(run.result, 'SUCCESS');
    before(run.ran, 'Quality Gates', 'QA Smoke');
    before(run.ran, 'QA Ready', 'QA Smoke');
    before(run.ran, 'QA Smoke', 'Validation Complete');
  });

  it('never runs QA Regression and never touches UAT', () => {
    assert.ok(!run.ran.includes('QA Regression'));
    for (const s of UAT) assert.ok(!run.ran.includes(s), `${s} must not run on a PR`);
  });

  it('cannot pass when QA Smoke or Quality Gates fail (nothing deployed after a gate failure)', () => {
    assert.match(simulate('feature/x', '7', { fail: 'QA Smoke' }).result, /^FAILURE/);
    const gates = simulate('feature/x', '7', { fail: 'Quality Gates' });
    assert.match(gates.result, /^FAILURE/);
    assert.ok(!gates.ran.includes('Deploy QA'));
  });

  it('cannot pass when a mandatory stage is skipped', () => {
    for (const skip of ['QA Smoke', 'QA Impacted Tests', 'Config Check', 'QA Gate']) {
      assert.match(simulate('feature/x', '7', { skip }).result, /^FAILURE/, `skip ${skip}`);
    }
  });

  it('defers a Regression-level impacted selection to main (scope "features" on PRs)', () => {
    assert.match(
      src,
      /IMPACTED_SCOPE=\$\{env\.BUILD_MODE == 'PULL REQUEST' \? 'features' : 'all'\}/,
    );
  });
});

describe('main (post-merge): Regression once, then automatic UAT promotion', () => {
  const run = simulate('main', null, { appImage: 'REUSE' });

  it('runs QA Regression exactly once, on QA, after QA Ready and before any UAT stage', () => {
    assert.equal(run.result, 'SUCCESS');
    assert.equal(run.ran.filter((s) => s === 'QA Regression').length, 1);
    before(run.ran, 'QA Ready', 'QA Regression');
    before(run.ran, 'QA Regression', 'UAT Promotion');
  });

  it('runs no QA Smoke and no impacted tests on main', () => {
    assert.ok(!run.ran.includes('QA Smoke'));
    assert.ok(!run.ran.includes('QA Impacted Tests'));
  });

  it('promotes automatically: no manual approval, input or milestone anywhere', () => {
    assert.doesNotMatch(src, /stage\('UAT Approval'\)/);
    assert.doesNotMatch(src, /\binput\s*\(/);
    assert.doesNotMatch(src, /\bmilestone\s*\(/);
    assert.doesNotMatch(src, /PARABANK_UAT_APPROVERS|PARABANK_UAT_APPROVAL_MINUTES/);
  });

  it('deploys the validated image to UAT, then UAT Smoke (4), then the record', () => {
    before(run.ran, 'UAT Promotion', 'Deploy UAT');
    before(run.ran, 'Deploy UAT', 'UAT Ready');
    before(run.ran, 'UAT Ready', 'UAT Smoke');
    before(run.ran, 'UAT Smoke', 'Deployment Record');
    before(run.ran, 'Deployment Record', 'Validation Complete');
  });

  it('does not redeploy UAT when it already runs the validated image, but still verifies it', () => {
    const r = simulate('main', null, { appImage: 'REUSE', uatRunsValidatedImage: true });
    assert.equal(r.result, 'SUCCESS');
    assert.ok(!r.ran.includes('Deploy UAT'));
    before(r.ran, 'UAT Promotion', 'UAT Ready');
    before(r.ran, 'UAT Ready', 'UAT Smoke');
  });

  it('has no UAT Regression stage', () => {
    assert.doesNotMatch(src, /stage\('UAT Regression'\)/);
    assert.ok(!run.ran.slice(run.ran.indexOf('UAT Promotion')).includes('QA Regression'));
  });

  it('blocks UAT when QA Regression fails or is skipped', () => {
    const failed = simulate('main', null, { fail: 'QA Regression' });
    assert.match(failed.result, /^FAILURE/);
    for (const s of UAT) assert.ok(!failed.ran.includes(s), `${s} must not run`);
    const skipped = simulate('main', null, { skip: 'QA Regression' });
    for (const s of UAT)
      assert.ok(!skipped.ran.includes(s), `${s} must not run without Regression`);
    assert.match(skipped.result, /^FAILURE at Validation Complete/);
  });

  it('aborts before promotion when main moved on (an outdated image never reaches UAT)', () => {
    const r = simulate('main', null, { headMovedBeforePromotion: true });
    assert.equal(r.result, 'ABORTED (SUPERSEDED)');
    assert.ok(!r.ran.includes('Deploy UAT'));
  });

  it('is not SUCCESS when UAT deployment, readiness or Smoke fails, or UAT Smoke is skipped', () => {
    for (const fail of ['Deploy UAT', 'UAT Ready', 'UAT Smoke']) {
      const r = simulate('main', null, { fail });
      assert.match(r.result, /^FAILURE/);
      assert.ok(!r.ran.includes('Deployment Record'));
    }
    assert.match(
      simulate('main', null, { skip: 'UAT Smoke' }).result,
      /^FAILURE at Validation Complete/,
    );
  });

  it('verifies the promoted image fail-closed (head, ID, revision, inputs digest)', () => {
    const promotion = src.slice(
      src.indexOf("stage('UAT Promotion')"),
      src.indexOf("stage('Deploy UAT')"),
    );
    assert.match(promotion, /Could not read the head/);
    assert.match(promotion, /test "\$IMAGE_ID" = "\$QA_IMAGE_ID"/);
    assert.match(promotion, /org\.opencontainers\.image\.revision/);
    assert.match(promotion, /parabank\.inputs\.digest/);
  });
});

describe('strict global serialization', () => {
  it('runs all work in ONE agent block (a lock holder never needs a second executor)', () => {
    assert.equal(src.match(/\bagent \{/g)?.length, 1);
    assert.doesNotMatch(src, /\bnode\s*\(/);
  });

  it('takes the global lock right after the workspace guard, before any other work', () => {
    for (const [branch, id] of [
      ['feature/x', '7'],
      ['main', null],
      ['feature/x', null],
      ['qa/x', null],
      ['config/x', null],
    ] as const) {
      const ran = simulate(branch, id, { appImage: 'REUSE' }).ran;
      const agentStages = ran.slice(ran.indexOf('Workspace Guard'));
      assert.equal(agentStages[1], 'Acquire Pipeline Lock', `${branch}/${id}`);
    }
  });

  it('releases the lock in the agent block post section on every outcome, with plain sh', () => {
    const post = src.slice(src.lastIndexOf('post {', src.indexOf("stage('Validation Complete')")));
    const always = post.slice(0, post.indexOf("stage('Validation Complete')"));
    assert.match(
      always,
      /always \{[\s\S]*sh 'sh scripts\/ci\/pipeline-lock\.sh release "\$BUILD_TAG"'/,
    );
  });

  it('fails without doing anything when the lock is not acquired within the bounded wait', () => {
    const r = simulate('main', null, { lockTimeout: true });
    assert.match(r.result, /^FAILURE/);
    assert.deepEqual(r.ran.slice(r.ran.indexOf('Workspace Guard')), [
      'Workspace Guard',
      'Acquire Pipeline Lock',
    ]);
  });
});

describe('application image (no rebuild for test-only changes)', () => {
  it('REUSE: no build and no QA deployment; QA is still verified', () => {
    for (const [branch, id] of [
      ['feature/x', '7'],
      ['main', null],
    ] as const) {
      const r = simulate(branch, id, { appImage: 'REUSE' });
      assert.ok(!r.ran.includes('Build Image'));
      assert.ok(!r.ran.includes('Deploy QA'));
      before(r.ran, 'Verify Application Image', 'QA Ready');
    }
  });

  it('DEPLOY: no build, deployment before QA Ready', () => {
    const r = simulate('main', null, { appImage: 'DEPLOY' });
    assert.ok(!r.ran.includes('Build Image'));
    before(r.ran, 'Deploy QA', 'QA Ready');
  });

  it('BUILD: build, verify, deploy, then validate', () => {
    const r = simulate('main', null, { appImage: 'BUILD' });
    before(r.ran, 'Resolve Application Image', 'Build Image');
    before(r.ran, 'Build Image', 'Verify Application Image');
    before(r.ran, 'Verify Application Image', 'Deploy QA');
    before(r.ran, 'Deploy QA', 'QA Regression');
  });

  it('decides under the pipeline lock', () => {
    before(simulate('main', null).ran, 'Acquire Pipeline Lock', 'Resolve Application Image');
  });

  it('config/* pushes neither build nor deploy', () => {
    const r = simulate('config/x', null);
    for (const s of ['Resolve Application Image', 'Build Image', 'Deploy QA']) {
      assert.ok(!r.ran.includes(s), s);
    }
  });
});
