// The proposed Jenkins matrix authorization (docs/security-hardening.md, Proposal 1) and its drill
// (scripts/ci/tests/matrix-auth-drill/run.sh, `npm run test:matrix-auth`, Docker, minutes). These
// checks read the files: what the proposal grants, that the drill never touches the real
// controller, and that the documented backup and rollback commands are the ones the drill ran.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const DIR = 'scripts/ci/tests/matrix-auth-drill';
const strategy = readFileSync(`${DIR}/matrix-strategy.xml`, 'utf8');
const drill = readFileSync(`${DIR}/run.sh`, 'utf8');
const doc = readFileSync('docs/security-hardening.md', 'utf8');
const permissions = [...strategy.matchAll(/<permission>([^<]+)<\/permission>/g)].map((m) => m[1]);

/** The drill's command with its throwaway names replaced by the real controller's. */
const asLive = (command: string) =>
  command
    .replace(/\\\n\s*/g, '')
    .replace(/"\$C"/g, 'jenkins')
    .replace(/"\$V:/g, 'jenkins_jenkins_home:')
    .replace(/\/var\/jenkins_home" "\$IMAGE"/g, '/var/jenkins_home jenkins-jenkins:latest')
    .replace(/\$STAMP/g, '<date>')
    .replace(/\s+/g, ' ')
    .trim();

describe('proposed matrix authorization', () => {
  it('is the global matrix strategy', () => {
    assert.match(
      strategy,
      /<authorizationStrategy class="hudson\.security\.GlobalMatrixAuthorizationStrategy">/,
    );
  });

  it('grants Administer to the owner only', () => {
    assert.deepEqual(
      permissions.filter((p) => p?.includes('.Administer:')),
      ['USER:hudson.model.Hudson.Administer:viamerico'],
    );
  });

  it('keeps admin able to log in (read), without disabling it', () => {
    assert.deepEqual(
      permissions.filter((p) => p?.endsWith(':admin')),
      ['USER:hudson.model.Hudson.Read:admin'],
    );
  });

  it('gives authenticated users read access only, and anonymous nothing', () => {
    assert.deepEqual(
      permissions.filter((p) => p?.startsWith('GROUP:')),
      [
        'GROUP:hudson.model.Hudson.Read:authenticated',
        'GROUP:hudson.model.Item.Read:authenticated',
      ],
    );
    assert.equal(
      permissions.some((p) => p?.includes('anonymous')),
      false,
    );
  });
});

describe('matrix authorization drill', () => {
  it('runs a throwaway Jenkins: no network, memory cap, never the real container or volume', () => {
    assert.match(drill, /^C=pb-matrix-drill$/m);
    assert.match(drill, /^V=pb-matrix-drill-home$/m);
    assert.match(drill, /docker create --name "\$C" --network none --memory \d+m -v "\$V:/);
    assert.doesNotMatch(
      drill,
      /docker (exec|stop|start|restart|rm|cp) [^\n]*\bjenkins\b(?!_home|-jenkins)/,
    );
  });

  it('never prints the generated passwords (no message of echo, ok or bad contains one)', () => {
    const messages = [...drill.matchAll(/\b(?:echo|ok|bad) "([^"]*)"/g)].map((m) => m[1] ?? '');
    assert.ok(messages.length > 20);
    for (const message of messages) assert.doesNotMatch(message, /PW_|PASSWORD/i, message);
  });

  it('documents exactly the backup command the drill ran', () => {
    const backup = /^docker exec "\$C" cp \/var\/jenkins_home\/config\.xml .*$/m.exec(drill)?.[0];
    assert.ok(backup);
    assert.ok(doc.includes(asLive(backup)), asLive(backup));
  });

  it('documents exactly the rollback command the drill ran', () => {
    const rollback =
      /^docker run --rm --network none --user 0 --entrypoint cp[^\n]*\\\n[^\n]*$/m.exec(drill)?.[0];
    assert.ok(rollback);
    assert.ok(doc.includes(asLive(rollback)), asLive(rollback));
  });
});
