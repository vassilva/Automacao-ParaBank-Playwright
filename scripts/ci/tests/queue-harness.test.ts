// The queue-serialization harness (scripts/ci/tests/queue-serialization/run.sh, `npm run
// test:queue`) runs a throwaway Jenkins; the full run needs Docker and minutes (docs/ci-cd.md,
// "Validation of the scheduling"). These checks read the script: what it needs from the Jenkins
// version it targets, and that it never changes the real controller.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const script = readFileSync('scripts/ci/tests/queue-serialization/run.sh', 'utf8');
const lines = script.split('\n').filter((line) => !line.trim().startsWith('#'));

describe('queue-serialization harness', () => {
  it('configures the Jenkins URL before the throwaway Jenkins starts (2.580.1 refuses the CLI without it)', () => {
    const config = script.indexOf('jenkins.model.JenkinsLocationConfiguration');
    const url = script.indexOf('<jenkinsUrl>http://localhost:8080/</jenkinsUrl>');
    const copied = script.indexOf('JenkinsLocationConfiguration.xml" "$NAME:/var/jenkins_home/"');
    const start = script.indexOf('docker start "$NAME"');
    assert.ok(config !== -1 && url !== -1 && copied !== -1 && start !== -1);
    assert.ok(copied < start, 'the configuration is in place before the first start');
  });

  it('isolates the throwaway Jenkins: no network, memory cap, never the real container name', () => {
    assert.match(script, /docker create --name "\$NAME" --network none --memory \d+m/);
    assert.match(script, /^NAME=\$\{QIT_CONTAINER:-parabank-queue-it\}$/m);
  });

  it('only reads from the real Jenkins ($SOURCE): one plugin tar to stdout, nothing else', () => {
    const uses = lines.filter((line) => line.includes('"$SOURCE"'));
    assert.deepEqual(
      uses.map((line) => line.trim()),
      [
        'docker exec "$SOURCE" tar -C /var/jenkins_home -cf - plugins | docker cp - "$NAME:/var/jenkins_home/"',
      ],
    );
  });

  it('removes, starts or restarts only the throwaway container', () => {
    const lifecycle = lines.filter((line) =>
      /docker (rm|stop|start|restart|kill|create)\b/.test(line),
    );
    assert.ok(lifecycle.length >= 4);
    for (const line of lifecycle) assert.match(line, /"\$NAME"/, line.trim());
  });
});
