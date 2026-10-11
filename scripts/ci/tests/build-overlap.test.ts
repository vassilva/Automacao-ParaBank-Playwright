// RUNNING-interval analysis of Jenkins build records (scripts/ci/build-overlap.ts).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findOverlaps, parseBuildXml, type BuildRecord } from '../build-overlap';

const xml = (fields: Record<string, string | number>, actions = '') =>
  `<?xml version="1.1"?><flow-build>${actions}<actions/>${Object.entries(fields)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('')}</flow-build>`;

const build = (job: string, running: number, finished: number | null): BuildRecord => ({
  job,
  number: 1,
  running,
  finished,
  result: finished === null ? null : 'SUCCESS',
  blockedMs: null,
});

describe('parseBuildXml()', () => {
  it('RUNNING from the record timestamp until startTime + duration', () => {
    const r = parseBuildXml(
      xml({ timestamp: 1000, startTime: 1010, result: 'SUCCESS', duration: 500 }),
      'main',
      5,
    );
    assert.deepEqual(r, {
      job: 'main',
      number: 5,
      running: 1000,
      finished: 1510,
      result: 'SUCCESS',
      blockedMs: null,
    });
  });

  it('takes the build-level blocked time (first queue record) and the last top-level result', () => {
    const actions =
      '<jenkins.metrics.impl.TimeInQueueAction><blockedDurationMillis>42000</blockedDurationMillis></jenkins.metrics.impl.TimeInQueueAction>' +
      '<jenkins.metrics.impl.TimeInQueueAction><blockedDurationMillis>7</blockedDurationMillis></jenkins.metrics.impl.TimeInQueueAction>' +
      '<some.Action><result>FAILURE</result></some.Action>';
    const r = parseBuildXml(
      xml({ timestamp: 1000, startTime: 1000, result: 'SUCCESS', duration: 1 }, actions),
      'PR-7',
      1,
    );
    assert.equal(r?.blockedMs, 42000);
    assert.equal(r?.result, 'SUCCESS');
  });

  it('a build without result or duration is still RUNNING', () => {
    const r = parseBuildXml(
      xml(
        { timestamp: 1000, startTime: 1000 },
        '<some.Action><result>SUCCESS</result></some.Action>',
      ),
      'main',
      6,
    );
    assert.equal(r?.finished, null);
    assert.equal(r?.result, null, "an action's result is not the build result");
  });

  it('reads the run fields, not the nested flow execution (real record: ABORTED run, FAILURE execution)', () => {
    const real =
      "<?xml version='1.1' encoding='UTF-8'?>\n<flow-build plugin=\"workflow-job@1571\">\n  <actions>\n" +
      '    <jenkins.metrics.impl.TimeInQueueAction plugin="metrics@4.2.37">\n' +
      '      <blockedDurationMillis>12000</blockedDurationMillis>\n    </jenkins.metrics.impl.TimeInQueueAction>\n' +
      '    <jenkins.metrics.impl.SubTaskTimeInQueueAction plugin="metrics@4.2.37">\n' +
      '      <blockedDurationMillis>0</blockedDurationMillis>\n    </jenkins.metrics.impl.SubTaskTimeInQueueAction>\n' +
      '  </actions>\n  <queueId>5289</queueId>\n  <timestamp>1791727340312</timestamp>\n' +
      '  <startTime>1791727340609</startTime>\n  <result>ABORTED</result>\n' +
      '  <description>PULL REQUEST</description>\n  <duration>222033</duration>\n  <keepLog>false</keepLog>\n' +
      '  <execution class="org.jenkinsci.plugins.workflow.cps.CpsFlowExecution">\n' +
      '    <result>FAILURE</result>\n    <script>a -&gt; b &lt;timestamp&gt;1&lt;/timestamp&gt;</script>\n' +
      '    <timestamp>1</timestamp>\n  </execution>\n  <completed>true</completed>\n</flow-build>\n';
    assert.deepEqual(parseBuildXml(real, 'PR-8', 1), {
      job: 'PR-8',
      number: 1,
      running: 1791727340312,
      finished: 1791727340609 + 222033,
      result: 'ABORTED',
      blockedMs: 12000,
    });
  });

  it('ignores a record without a timestamp', () => {
    assert.equal(parseBuildXml(xml({ result: 'SUCCESS' }), 'main', 1), null);
  });
});

describe('findOverlaps()', () => {
  it('reports two builds RUNNING together (the main #5 / branch #1 case)', () => {
    const o = findOverlaps([build('main', 0, 330_000), build('branch', 13, 474_000)]);
    assert.equal(o.length, 1);
    assert.equal(o[0]?.ms, 330_000 - 13);
  });

  it('back-to-back builds (next starts when the previous finished) do not overlap', () => {
    assert.deepEqual(
      findOverlaps([build('main', 0, 100), build('PR-1', 100, 200), build('PR-2', 250, 300)]),
      [],
    );
  });

  it('an open build overlaps everything that started after it', () => {
    const o = findOverlaps([build('main', 0, null), build('PR-1', 50, 60)], 1000);
    assert.equal(o.length, 1);
    assert.equal(o[0]?.ms, 10);
  });

  it('finds every pair, not only neighbours', () => {
    const o = findOverlaps([build('a', 0, 1000), build('b', 10, 20), build('c', 30, 40)]);
    assert.deepEqual(
      o.map((x) => `${x.first.job}-${x.second.job}`),
      ['a-b', 'a-c'],
    );
  });
});
