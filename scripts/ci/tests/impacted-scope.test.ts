// Pull requests never run the full Regression; feature-level selections still run.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, deferredToMain } from '../impacted-tests';

describe('impacted tests on pull requests', () => {
  it('defers a Regression-level selection (shared code) to the post-merge QA Regression', () => {
    const s = classify('test', ['src/support/hooks.ts']);
    assert.equal(s.kind, 'regression');
    assert.equal(deferredToMain(s, 'features'), true);
  });

  it('defers gate-defining changes too (they select Regression)', () => {
    const s = classify('test', ['Jenkinsfile']);
    assert.equal(deferredToMain(s, 'features'), true);
  });

  it('still runs a feature-level selection on a PR', () => {
    const s = classify('test', ['features/transfers/transfer-funds.feature']);
    assert.equal(s.kind, 'features');
    assert.equal(deferredToMain(s, 'features'), false);
  });

  it('runs the Regression selection on qa/* pushes (scope "all")', () => {
    const s = classify('test', ['src/support/hooks.ts']);
    assert.equal(deferredToMain(s, 'all'), false);
  });
});
