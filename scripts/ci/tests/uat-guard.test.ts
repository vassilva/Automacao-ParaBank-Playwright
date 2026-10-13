// UAT changes outside the Jenkins UAT Approval (scripts/uat-guard.ts), without Docker: the guard is
// a pure decision on the command and the environment variables; the Jenkinsfile is read as text to
// check that the approved path really provides what the guard expects.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { BREAK_GLASS_VARIABLE, uatGuard } from '../../uat-guard';

const JENKINS_BUILD = { BUILD_TAG: 'jenkins-Automacao-ParaBank-Playwright-main-14' };
const APPROVED = { ...JENKINS_BUILD, UAT_APPROVER: 'approver-id' };

describe('UAT guard: what it refuses', () => {
  it('refuses a local deploy to UAT (npm run uat:deploy) without approval or break-glass', () => {
    const decision = uatGuard('deploy', 'uat', {}, {});
    assert.equal(decision.allowed, false);
  });

  it('refuses a teardown that removes UAT, but not one that leaves it running', () => {
    assert.equal(uatGuard('teardown', 'uat', {}, {}).allowed, false);
    assert.equal(uatGuard('teardown', 'uat', { keepRunning: true }, {}).allowed, true);
  });

  it('refuses a Jenkins build that has no recorded approver (approval not reached or rejected)', () => {
    assert.equal(uatGuard('deploy', 'uat', {}, JENKINS_BUILD).allowed, false);
    assert.equal(
      uatGuard('deploy', 'uat', {}, { ...JENKINS_BUILD, UAT_APPROVER: ' ' }).allowed,
      false,
    );
  });

  it('refuses an approver outside a Jenkins build, and any other break-glass value', () => {
    assert.equal(uatGuard('deploy', 'uat', {}, { UAT_APPROVER: 'approver-id' }).allowed, false);
    for (const value of ['', 'true', '1', 'yes', 'OWNER']) {
      assert.equal(uatGuard('deploy', 'uat', {}, { [BREAK_GLASS_VARIABLE]: value }).allowed, false);
    }
  });

  it('explains the approved path and the break-glass in the refusal', () => {
    const decision = uatGuard('deploy', 'uat', {}, {});
    assert.ok(!decision.allowed && decision.reason.includes('UAT Approval'));
    assert.ok(!decision.allowed && decision.reason.includes(BREAK_GLASS_VARIABLE));
  });
});

describe('UAT guard: what it allows', () => {
  it('allows the deployment of a Jenkins build whose UAT Approval recorded an approver', () => {
    assert.deepEqual(uatGuard('deploy', 'uat', {}, APPROVED), {
      allowed: true,
      via: 'jenkins-approval',
    });
  });

  it("allows the owner's explicit break-glass (documented rollback)", () => {
    assert.deepEqual(uatGuard('deploy', 'uat', {}, { [BREAK_GLASS_VARIABLE]: 'owner' }), {
      allowed: true,
      via: 'owner-break-glass',
    });
  });

  it('leaves QA and the read-only or reversible UAT commands alone', () => {
    for (const [command, environment] of [
      ['deploy', 'qa'],
      ['teardown', 'qa'],
      ['start', 'uat'],
      ['stop', 'uat'],
      ['status', 'uat'],
      ['health', 'uat'],
      ['identity', 'uat'],
    ] as const) {
      assert.equal(
        uatGuard(command, environment, {}, {}).allowed,
        true,
        `${command} ${environment}`,
      );
    }
  });
});

describe('UAT guard: the Jenkinsfile provides the approved path', () => {
  const jenkinsfile = readFileSync('Jenkinsfile', 'utf8');
  const at = (text: string) => {
    const index = jenkinsfile.indexOf(text);
    assert.notEqual(index, -1, `Jenkinsfile contains ${text}`);
    return index;
  };

  it('records the approver in UAT Approval before Deploy UAT runs the deployment', () => {
    const approval = at("stage('UAT Approval')");
    const recorded = at('env.UAT_APPROVER = approver');
    const deployStage = at("stage('Deploy UAT')");
    const deployCall = at('env -- deploy uat');
    assert.ok(approval < recorded && recorded < deployStage && deployStage < deployCall);
  });

  it('scripts/environment.ts consults the guard before running any command', () => {
    const source = readFileSync('scripts/environment.ts', 'utf8');
    const main = source.indexOf('function main()');
    const guard = source.indexOf('uatGuard(', main);
    const refuse = source.indexOf('if (!guard.allowed) throw', main);
    const dispatch = source.indexOf('switch (command)', main);
    assert.ok(main !== -1 && main < guard && guard < refuse && refuse < dispatch);
  });

  it('never takes the break-glass path (Jenkinsfile and package scripts)', () => {
    assert.equal(jenkinsfile.includes(BREAK_GLASS_VARIABLE), false);
    assert.equal(readFileSync('package.json', 'utf8').includes(BREAK_GLASS_VARIABLE), false);
  });
});
