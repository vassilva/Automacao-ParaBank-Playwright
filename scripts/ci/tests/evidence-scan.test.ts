// Archived-evidence scan (scripts/ci/evidence-scan.ts). Every value is synthetic and built here in
// the generated shapes; assertions report detector names and counts, never a value.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { DETECTORS, scanFile, scanPaths, scanText, zipEntries } from '../evidence-scan';

const PASSWORD = 'PwSyntheticValue0001'; // "Pw" + 16 base64url characters
const USERNAME = 'qa0synthetic01'; // "qa" + lowercase letters and digits
const SSN = '000-12-3456';
const SESSION = 'A1B2C3D4E5F6';

const detected = (text: string) => scanText(text).map(({ detector }) => detector);

/** Deterministic pseudo-random base64 (an embedded screenshot), so the test never flakes. */
function base64Noise(bytes: number): string {
  let state = 0x2545f491;
  const buffer = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    buffer[i] = state >>> 24;
  }
  return buffer.toString('base64');
}

describe('evidence scan: what it finds', () => {
  const leaks: [string, string, string][] = [
    ['synthetic-ssn', 'ParaBank log', `Customer [ssn=${SSN}]`],
    ['password-shape', 'Cucumber JSON', `{"error_message":"login failed for ${PASSWORD}"}`],
    ['username-shape', 'JUnit text', `<failure>user ${USERNAME} not found</failure>`],
    ['session-id', 'URL in a report', `/parabank/overview.htm;jsessionid=${SESSION}`],
    ['auth-header', 'cookie header', `cookie: JSESSIONID=${SESSION}`],
    ['auth-header', 'authorization header', `Authorization: Basic ${SESSION}`],
  ];
  for (const [detector, where, text] of leaks) {
    it(`finds ${detector} (${where})`, () => {
      assert.ok(detected(text).includes(detector));
    });
  }

  it('finds a secret next to an embedded screenshot', () => {
    const text = `{"data":"${base64Noise(4096)}","note":"${PASSWORD}"}`;
    assert.deepEqual(detected(text), ['password-shape']);
  });

  it('counts every occurrence', () => {
    assert.deepEqual(scanText(`${SSN} and ${SSN}`), [{ detector: 'synthetic-ssn', count: 2 }]);
  });
});

describe('evidence scan: what it leaves alone', () => {
  const clean: [string, string][] = [
    ['masked key/value (log redaction)', 'Customer [username=[REDACTED], password=[REDACTED]]'],
    ['masked session id', '/parabank/index.htm;jsessionid=[REDACTED]'],
    ['masked header', 'cookie: [REDACTED]'],
    ['withheld log line', '[WITHHELD: line with an unrecognized credential]'],
    ['Gherkin wording', 'When I sign in with my password and my username'],
    ['bundled report viewer code', 'const o={email:!0,month:!0,password:!0,range:!0}'],
    ['ordinary words starting with qa or Pw', 'qa-automation Pwned qa: pending'],
  ];
  for (const [what, text] of clean) {
    it(`ignores ${what}`, () => {
      assert.deepEqual(detected(text), []);
    });
  }

  it('ignores 1 MB of embedded base64 (screenshots never match by chance)', () => {
    assert.deepEqual(detected(`{"mime_type":"image/png","data":"${base64Noise(768 * 1024)}"}`), []);
  });

  it('uses the redaction shapes, not a copy of them', () => {
    assert.ok(Object.keys(DETECTORS).length >= 5);
    assert.equal(DETECTORS['password-shape']?.source.includes('Pw'), true);
  });
});

describe('evidence scan: files and the command line', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'evidence-scan-'));
  after(() => rmSync(root, { recursive: true, force: true }));

  const tree = (name: string) => {
    const dir = path.join(root, name);
    mkdirSync(path.join(dir, 'logs'), { recursive: true });
    writeFileSync(path.join(dir, 'cucumber-report.json'), '{"status":"passed"}');
    writeFileSync(path.join(dir, 'logs', 'qa.log'), 'password=[REDACTED]\n');
    writeFileSync(path.join(dir, 'screenshot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return dir;
  };

  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ['--require', 'ts-node/register', path.join('scripts', 'ci', 'evidence-scan.ts'), ...args],
      { encoding: 'utf8' },
    );

  it('scans text files only and skips binaries', () => {
    const { findings, scanned, skipped } = scanPaths([tree('counts')]);
    assert.deepEqual(
      { findings: findings.length, scanned, skipped },
      { findings: 0, scanned: 2, skipped: 1 },
    );
  });

  it('passes a clean tree (exit 0)', () => {
    const result = run(tree('clean'));
    assert.equal(result.status, 0);
    assert.match(result.stdout, /EVIDENCE SCAN OK/);
  });

  it('fails on a leak, names the file and detector, never the value (exit 1)', () => {
    const dir = tree('leak');
    writeFileSync(path.join(dir, 'logs', 'uat.log'), `login ${USERNAME} with ${PASSWORD}\n`);
    const result = run(dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /SENSITIVE password-shape x1 in .*uat\.log/);
    assert.equal(result.stdout.includes(PASSWORD) || result.stdout.includes(USERNAME), false);
    assert.equal(existsSync(path.join(dir, 'logs', 'uat.log')), true);
  });

  it('--quarantine removes only the flagged files (exit 1)', () => {
    const dir = tree('quarantine');
    const flagged = path.join(dir, 'logs', 'uat.log');
    writeFileSync(flagged, `ssn ${SSN}\n`);
    const result = run('--quarantine', dir);
    assert.equal(result.status, 1);
    assert.equal(existsSync(flagged), false);
    assert.equal(existsSync(path.join(dir, 'cucumber-report.json')), true);
    assert.equal(existsSync(path.join(dir, 'logs', 'qa.log')), true);
  });

  it('ignores missing targets (a build that produced no reports) and refuses no target', () => {
    assert.equal(run(path.join(root, 'absent')).status, 0);
    assert.equal(run().status, 2);
  });
});

/** A minimal zip (deflated entries, central directory), like the one a Playwright report embeds. */
function zip(entries: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = deflateRawSync(Buffer.from(content));
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const playwrightReport = (archive: Buffer) =>
  `<html><template id="playwrightReportBase64">data:application/zip;base64,${archive.toString('base64')}</template></html>`;

describe('evidence scan: compressed evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'evidence-zip-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const file = (name: string, content: string | Buffer) => {
    const target = path.join(root, name);
    writeFileSync(target, content);
    return target;
  };
  const hits = (target: string) => (scanFile(target) ?? []).map(({ detector }) => detector);

  it('reads every entry of a zip (stored size, deflate)', () => {
    const entries = zipEntries(zip({ 'report.json': '{"ok":true}', 'a/b.json': '[]' }));
    assert.deepEqual(
      entries.map(({ name, data }) => [name, data.toString()]),
      [
        ['report.json', '{"ok":true}'],
        ['a/b.json', '[]'],
      ],
    );
  });

  it('finds a leak inside the zip a Playwright HTML report embeds', () => {
    const report = playwright('leak.html', { 'report.json': `{"title":"login ${PASSWORD}"}` });
    assert.deepEqual(hits(report), ['password-shape']);
  });

  it('passes a clean Playwright HTML report and skips image entries inside it', () => {
    const report = playwright('clean.html', {
      'report.json': '{"title":"sign in with my password: [REDACTED]"}',
      'data/shot.png': Buffer.from(base64Noise(64 * 1024), 'base64'),
    });
    assert.deepEqual(hits(report), []);
  });

  it('scans .zip files too', () => {
    assert.deepEqual(hits(file('evidence.zip', zip({ 'notes.txt': `ssn ${SSN}` }))), [
      'synthetic-ssn',
    ]);
  });

  it('flags a Playwright trace, which can never be redacted', () => {
    assert.ok(hits(file('trace.zip', zip({ 'test.trace': '{}' }))).includes('playwright-trace'));
  });

  it('fails closed on evidence it cannot open', () => {
    assert.deepEqual(hits(file('broken.zip', Buffer.from('not a zip'))), ['unreadable']);
    const html = file('broken.html', '<template>data:application/zip;base64,AAAA</template>');
    assert.deepEqual(hits(html), ['unreadable']);
  });

  function playwright(name: string, entries: Record<string, string | Buffer>): string {
    return file(name, playwrightReport(zip(entries)));
  }
});

describe('evidence scan: wired into the Jenkinsfile before publishing', () => {
  const jenkinsfile = readFileSync('Jenkinsfile', 'utf8');
  const scan = jenkinsfile.indexOf('ci:evidence-scan -- --quarantine reports build deployment');
  const release = jenkinsfile.indexOf('pipeline-lock.sh release', scan);
  const publishes = jenkinsfile.indexOf('if (scan == 0 || scan == 1)', release);
  const junit = jenkinsfile.indexOf('junit testResults');
  const archive = jenkinsfile.indexOf('archiveArtifacts');

  it('scans before JUnit is published and before anything is archived', () => {
    assert.ok(scan !== -1 && scan < junit && scan < archive);
    assert.equal(jenkinsfile.indexOf('junit testResults', junit + 1), -1, 'one junit step only');
  });

  it('fails the build on a finding and on a scan error', () => {
    const fail = jenkinsfile.indexOf("currentBuild.result = 'FAILURE'", scan);
    const failAgain = jenkinsfile.indexOf("currentBuild.result = 'FAILURE'", fail + 1);
    assert.ok(fail !== -1 && failAgain !== -1 && failAgain < release);
  });

  it('releases the lock first, then publishes only verified evidence (fail closed)', () => {
    assert.ok(release !== -1 && release < publishes && publishes < junit && junit < archive);
  });
});
