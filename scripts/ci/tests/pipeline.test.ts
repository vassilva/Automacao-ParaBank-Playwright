// Pipeline order and gates, evaluated on the Jenkinsfile's own `when` expressions (pipeline-model).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { simulate } from './pipeline-model';

const before = (ran: string[], a: string, b: string) => {
  assert.ok(ran.includes(a), `${a} ran`);
  assert.ok(ran.includes(b), `${b} ran`);
  assert.ok(ran.indexOf(a) < ran.indexOf(b), `${a} before ${b}`);
};
const UAT = ['UAT Approval', 'UAT Deployment', 'Promote to UAT', 'UAT Smoke'];

describe('pull request (pre-merge)', () => {
  const run = simulate('feature/x', '7');

  it('runs Quality Gates, then QA Smoke, before the PR can pass', () => {
    assert.equal(run.result, 'SUCCESS');
    before(run.ran, 'Quality Gates', 'QA Smoke');
    before(run.ran, 'QA Ready', 'QA Smoke');
    before(run.ran, 'QA Smoke', 'Validation Complete');
  });

  it('never runs the QA Regression stage and never touches UAT', () => {
    assert.ok(!run.ran.includes('QA Regression'));
    for (const s of UAT) assert.ok(!run.ran.includes(s), `${s} must not run on a PR`);
  });

  it('cannot pass when QA Smoke fails', () => {
    const failed = simulate('feature/x', '7', { fail: 'QA Smoke' });
    assert.match(failed.result, /^FAILURE/);
    assert.ok(!failed.ran.includes('Validation Complete'));
  });

  it('cannot pass when Quality Gates fail, and nothing is deployed', () => {
    const failed = simulate('feature/x', '7', { fail: 'Quality Gates' });
    assert.match(failed.result, /^FAILURE/);
    assert.ok(!failed.ran.includes('Deploy QA'));
  });

  it('cannot pass when a mandatory stage is skipped', () => {
    for (const skip of ['QA Smoke', 'QA Impacted Tests', 'Config Check', 'QA Gate']) {
      assert.match(simulate('feature/x', '7', { skip }).result, /^FAILURE/, `skip ${skip}`);
    }
  });

  it('defers a Regression-level impacted selection to main (scope "features" on PRs)', () => {
    const src = readFileSync('Jenkinsfile', 'utf8');
    assert.match(
      src,
      /IMPACTED_SCOPE=\$\{env\.BUILD_MODE == 'PULL REQUEST' \? 'features' : 'all'\}/,
    );
  });
});

describe('main (post-merge promotion)', () => {
  const run = simulate('main', null, { appImage: 'REUSE' });

  it('runs QA Regression once, on QA, after the image is validated and before the approval', () => {
    assert.equal(run.result, 'SUCCESS');
    assert.equal(run.ran.filter((s) => s === 'QA Regression').length, 1);
    before(run.ran, 'QA Ready', 'QA Regression');
    before(run.ran, 'QA Regression', 'UAT Approval');
  });

  it('runs no QA Smoke and no impacted tests on main', () => {
    assert.ok(!run.ran.includes('QA Smoke'));
    assert.ok(!run.ran.includes('QA Impacted Tests'));
  });

  it('deploys to UAT only after the approval, then runs UAT Smoke, then records', () => {
    before(run.ran, 'UAT Approval', 'Verify Approved Image');
    before(run.ran, 'Verify Approved Image', 'Promote to UAT');
    before(run.ran, 'Promote to UAT', 'UAT Ready');
    before(run.ran, 'UAT Ready', 'UAT Smoke');
    before(run.ran, 'UAT Smoke', 'Deployment Record');
  });

  it('has no UAT Regression stage', () => {
    assert.doesNotMatch(readFileSync('Jenkinsfile', 'utf8'), /stage\('UAT Regression'\)/);
  });

  it('stops before the approval when QA Regression fails', () => {
    const failed = simulate('main', null, { fail: 'QA Regression' });
    assert.match(failed.result, /^FAILURE/);
    for (const s of UAT) assert.ok(!failed.ran.includes(s), `${s} must not run`);
  });

  it('deploys nothing to UAT when the approval is rejected, times out, is unauthorized or superseded', () => {
    for (const approval of ['reject', 'timeout', 'unauthorized', 'superseded'] as const) {
      const r = simulate('main', null, { approval });
      assert.ok(!r.ran.includes('Promote to UAT'), approval);
      assert.notEqual(r.result, 'SUCCESS', approval);
    }
  });

  it('aborts before promotion when main moved on after the approval', () => {
    const r = simulate('main', null, { headMovedBeforeVerify: true });
    assert.equal(r.result, 'ABORTED (SUPERSEDED)');
    assert.ok(!r.ran.includes('Promote to UAT'));
  });

  it('is not SUCCESS when UAT readiness or UAT Smoke fails', () => {
    for (const fail of ['UAT Ready', 'UAT Smoke']) {
      const r = simulate('main', null, { fail });
      assert.match(r.result, /^FAILURE/);
      assert.ok(!r.ran.includes('Deployment Record'));
    }
  });
});

describe('application image (no rebuild for test-only changes)', () => {
  it('REUSE: no build and no deployment; QA is still verified', () => {
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

  it('decides under the host lock', () => {
    before(simulate('main', null).ran, 'Acquire Host Lock', 'Resolve Application Image');
  });

  it('config/* pushes neither build nor deploy', () => {
    const r = simulate('config/x', null);
    for (const s of [
      'Acquire Host Lock',
      'Resolve Application Image',
      'Build Image',
      'Deploy QA',
    ]) {
      assert.ok(!r.ran.includes(s), s);
    }
  });
});
