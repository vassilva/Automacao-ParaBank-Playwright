/**
 * Did two builds of the ParaBank Multibranch job ever appear RUNNING at the same time?
 *
 * Reads Jenkins build records (build.xml) and compares RUNNING intervals: a build is RUNNING from
 * the moment it leaves the queue (`timestamp`, when the build record is created) until it finishes
 * (`startTime` + `duration`). Jenkins evidence, not pipeline logs: a build waiting for a lock inside
 * the pipeline is RUNNING; a build held in the queue has no record yet.
 *
 *   ts-node scripts/ci/build-overlap.ts <branches-dir> [--since <epoch-ms|ISO date>]
 *
 * <branches-dir> is a copy of $JENKINS_HOME/jobs/<multibranch>/branches (only build.xml files are
 * needed). Builds that became RUNNING before --since are listed but not judged (history before a
 * scheduling change). Exit 1 when two judged builds overlap. The time a build spent blocked in the
 * queue comes from the metrics plugin (TimeInQueueAction), when recorded.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export interface BuildRecord {
  job: string;
  number: number;
  /** Left the queue: RUNNING from here (epoch ms). */
  running: number;
  /** Finished (epoch ms), or null while still building. */
  finished: number | null;
  result: string | null;
  /** Time blocked in the queue before RUNNING (ms), when the metrics plugin recorded it. */
  blockedMs: number | null;
}

/**
 * The text of the root element's direct children (the run's own fields: timestamp, startTime,
 * result, duration). Nested elements are skipped: a real record also holds, for example, the
 * flow execution's own <result> (FAILURE for a run that ended ABORTED) after the run's <result>.
 * XStream escapes "<" in text, so every "<" starts a tag.
 */
export function topLevelFields(xml: string): Map<string, string> {
  const fields = new Map<string, string>();
  let depth = 0;
  let open: { name: string; from: number } | null = null;
  for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w.$-]*)[^>]*?(\/?)>/g)) {
    const [tag, closing, name = '', selfClosing] = m;
    const at = m.index ?? 0;
    if (closing) {
      depth--;
      if (depth === 1 && open !== null && open.name === name) {
        if (!fields.has(name)) fields.set(name, xml.slice(open.from, at).trim());
        open = null;
      }
    } else if (!selfClosing) {
      depth++;
      if (depth === 2) open = { name, from: at + tag.length };
    }
  }
  return fields;
}

export function parseBuildXml(xml: string, job: string, number: number): BuildRecord | null {
  const fields = topLevelFields(xml);
  const timestamp = Number(fields.get('timestamp'));
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  const startTime = Number(fields.get('startTime') ?? timestamp);
  const durationText = fields.get('duration') ?? null;
  const result = fields.get('result') ?? null;
  // A finished build has its own result and a non-zero duration; anything else is still RUNNING.
  const finished =
    result !== null && durationText !== null && Number(durationText) > 0
      ? startTime + Number(durationText)
      : null;
  // The build's own queue time (metrics plugin); SubTaskTimeInQueueAction entries are its node blocks.
  const blocked =
    /<jenkins\.metrics\.impl\.TimeInQueueAction[\s>][\s\S]*?<blockedDurationMillis>(\d+)<\/blockedDurationMillis>/.exec(
      xml,
    );
  return {
    job,
    number,
    running: timestamp,
    finished,
    result: finished === null ? null : result,
    blockedMs: blocked ? Number(blocked[1]) : null,
  };
}

export interface Overlap {
  first: BuildRecord;
  second: BuildRecord;
  /** Milliseconds both were RUNNING. */
  ms: number;
}

/** Every pair of builds whose RUNNING intervals intersect (an open build runs until `now`). */
export function findOverlaps(builds: BuildRecord[], now = Date.now()): Overlap[] {
  const sorted = [...builds].sort((a, b) => a.running - b.running);
  const overlaps: Overlap[] = [];
  sorted.forEach((a, i) => {
    const aEnd = a.finished ?? now;
    for (const b of sorted.slice(i + 1)) {
      if (b.running >= aEnd) {
        break;
      }
      overlaps.push({ first: a, second: b, ms: Math.min(aEnd, b.finished ?? now) - b.running });
    }
  });
  return overlaps;
}

export function readBuilds(branchesDir: string): BuildRecord[] {
  const builds: BuildRecord[] = [];
  for (const job of readdirSync(branchesDir)) {
    const buildsDir = path.join(branchesDir, job, 'builds');
    if (!existsSync(buildsDir)) {
      continue;
    }
    for (const entry of readdirSync(buildsDir)) {
      const file = path.join(buildsDir, entry, 'build.xml');
      if (!/^\d+$/.test(entry) || !existsSync(file)) {
        continue;
      }
      const record = parseBuildXml(readFileSync(file, 'utf8'), job, Number(entry));
      if (record) {
        builds.push(record);
      }
    }
  }
  return builds.sort((a, b) => a.running - b.running);
}

function parseSince(value: string): number {
  const asNumber = Number(value);
  const ms = Number.isFinite(asNumber) ? asNumber : Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`--since: not a date or epoch milliseconds: ${value}`);
  }
  return ms;
}

function main(argv: string[]): number {
  const dir = argv[0];
  const sinceIndex = argv.indexOf('--since');
  const since = sinceIndex >= 0 ? parseSince(argv[sinceIndex + 1] ?? '') : 0;
  if (!dir || !existsSync(dir)) {
    console.error('Usage: build-overlap.ts <branches-dir> [--since <epoch-ms|ISO date>]');
    return 2;
  }
  const builds = readBuilds(dir);
  const iso = (ms: number | null) => (ms === null ? 'RUNNING' : new Date(ms).toISOString());
  for (const b of builds) {
    const blocked = b.blockedMs === null ? '-' : `${(b.blockedMs / 1000).toFixed(1)}s`;
    const judged = b.running >= since ? '' : ' (before --since)';
    console.log(
      `${iso(b.running)}  ${iso(b.finished)}  blocked ${blocked.padStart(7)}  ${b.result ?? '-'}  ${b.job} #${b.number}${judged}`,
    );
  }
  const overlaps = findOverlaps(builds.filter((b) => b.running >= since));
  for (const o of overlaps) {
    console.log(
      `OVERLAP: ${o.first.job} #${o.first.number} and ${o.second.job} #${o.second.number} RUNNING together for ${(o.ms / 1000).toFixed(1)}s`,
    );
  }
  console.log(
    `${builds.filter((b) => b.running >= since).length} builds judged, ${overlaps.length} overlapping pair(s)`,
  );
  return overlaps.length ? 1 : 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
