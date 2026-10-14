/**
 * Last check before evidence is archived: no sensitive value may survive in the reports, logs and
 * records a build keeps. Redaction happens where evidence is written (src/support/redaction.ts,
 * scripts/log-redaction.ts, playwright/redacting-reporter.ts); this verifies the result, so a new
 * code path that bypasses redaction fails the build instead of leaking into Jenkins.
 *
 *   ts-node scripts/ci/evidence-scan.ts <dir|file>... [--quarantine]
 *
 * Detectors: the shapes of the values this suite generates (synthetic SSN, password, username;
 * SECRET_SHAPES) and session ids, cookies and authorization headers that are not masked. Long
 * base64 runs (embedded screenshots) are skipped: a secret is far shorter, and random base64 would
 * otherwise match the shapes by chance. Compressed evidence is opened and scanned entry by entry:
 * `.zip` files and the zip a Playwright HTML report embeds in its index.html. A Playwright trace is
 * flagged as such (traces cannot be redacted and are never allowed in CI). Other binary files are
 * not scanned (screenshots are masked when they are taken). Fail closed: a file that cannot be read
 * or opened is flagged. Output names files, detectors and counts, never a value.
 *
 * Exit 1 when anything is found. --quarantine also deletes the flagged files, so the build archives
 * the rest of its evidence without them. Exit 2 on a usage error.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { SECRET_SHAPES } from '../../src/support/redaction';

const MASKED = String.raw`(?:\[REDACTED\]|\[WITHHELD[^\]]*\])`;

export const DETECTORS: Readonly<Record<string, RegExp>> = {
  'synthetic-ssn': SECRET_SHAPES.ssn,
  'password-shape': SECRET_SHAPES.password,
  'username-shape': SECRET_SHAPES.username,
  'session-id': new RegExp(String.raw`jsessionid=(?!${MASKED})[^;?&#\s"'/\\]+`, 'gi'),
  'auth-header': new RegExp(
    String.raw`\b(?:cookie|set-cookie|authorization|proxy-authorization)\s*:\s*(?!${MASKED})[^\s"',;]+`,
    'gi',
  ),
};

const TEXT_EXTENSIONS = new Set(['.json', '.html', '.htm', '.xml', '.txt', '.log', '.md', '.csv']);
const BASE64_RUN = /[A-Za-z0-9+/]{200,}={0,2}/g;
const EMBEDDED_ZIP = /data:application\/zip;base64,([A-Za-z0-9+/=]+)/g;

type Hit = { detector: string; count: number };

export interface Finding extends Hit {
  file: string;
}

/** Findings in one text, by detector (counts only). */
export function scanText(text: string): Hit[] {
  const scannable = text.replace(BASE64_RUN, ' ');
  return Object.entries(DETECTORS)
    .map(([detector, pattern]) => ({ detector, count: scannable.match(pattern)?.length ?? 0 }))
    .filter(({ count }) => count > 0);
}

/** The entries of a zip archive (central directory; stored or deflated). Throws when malformed. */
export function zipEntries(zip: Buffer): { name: string; data: Buffer }[] {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('no zip end-of-central-directory record');
  const count = zip.readUInt16LE(end + 10);
  let entry = zip.readUInt32LE(end + 16);
  const entries: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(entry) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = zip.readUInt16LE(entry + 10);
    const size = zip.readUInt32LE(entry + 20);
    const nameLength = zip.readUInt16LE(entry + 28);
    const extraLength = zip.readUInt16LE(entry + 30);
    const commentLength = zip.readUInt16LE(entry + 32);
    const local = zip.readUInt32LE(entry + 42);
    const name = zip.toString('utf8', entry + 46, entry + 46 + nameLength);
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('bad zip local header');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`unsupported zip method ${method}`);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : raw });
    entry += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function addHits(into: Map<string, number>, hits: Hit[]): void {
  for (const { detector, count } of hits) into.set(detector, (into.get(detector) ?? 0) + count);
}

/** Zip entries holding text (report JSON, trace events); images and other binaries are skipped. */
const TEXT_ENTRY = /\.(json|jsonl|md|txt|html|xml|log|csv|trace|network)$/i;

function scanZip(zip: Buffer, into: Map<string, number>): void {
  for (const { name, data } of zipEntries(zip)) {
    if (name.endsWith('.trace')) addHits(into, [{ detector: 'playwright-trace', count: 1 }]);
    if (TEXT_ENTRY.test(name)) addHits(into, scanText(data.toString('utf8')));
  }
}

/** Findings in one file: text, embedded report zips, zip archives; unreadable -> flagged. */
export function scanFile(file: string): Hit[] | null {
  const extension = path.extname(file).toLowerCase();
  const isTrace = path.basename(file).toLowerCase() === 'trace.zip';
  if (!TEXT_EXTENSIONS.has(extension) && extension !== '.zip') return null;
  const hits = new Map<string, number>();
  try {
    if (isTrace) addHits(hits, [{ detector: 'playwright-trace', count: 1 }]);
    if (extension === '.zip') {
      scanZip(readFileSync(file), hits);
    } else {
      const text = readFileSync(file, 'utf8');
      addHits(hits, scanText(text));
      for (const [, base64] of text.matchAll(EMBEDDED_ZIP)) {
        scanZip(Buffer.from(base64 ?? '', 'base64'), hits);
      }
    }
  } catch {
    addHits(hits, [{ detector: 'unreadable', count: 1 }]);
  }
  return [...hits].map(([detector, count]) => ({ detector, count }));
}

function filesUnder(target: string): string[] {
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target).flatMap((entry) => filesUnder(path.join(target, entry)));
}

export function scanPaths(targets: string[]): {
  findings: Finding[];
  scanned: number;
  skipped: number;
} {
  const findings: Finding[] = [];
  let scanned = 0;
  let skipped = 0;
  for (const target of targets.filter((t) => existsSync(t))) {
    for (const file of filesUnder(target)) {
      const hits = scanFile(file);
      if (hits === null) {
        skipped++;
        continue;
      }
      scanned++;
      for (const hit of hits) findings.push({ file, ...hit });
    }
  }
  return { findings, scanned, skipped };
}

function main(): void {
  const args = process.argv.slice(2);
  const quarantine = args.includes('--quarantine');
  const targets = args.filter((arg) => arg !== '--quarantine');
  if (targets.length === 0) {
    console.error('Usage: evidence-scan.ts <dir|file>... [--quarantine]');
    process.exit(2);
  }
  const { findings, scanned, skipped } = scanPaths(targets);
  console.log(`EVIDENCE SCAN: ${scanned} file(s) scanned, ${skipped} binary file(s) skipped`);
  if (findings.length === 0) {
    console.log('EVIDENCE SCAN OK: no unmasked sensitive value');
    return;
  }
  for (const { file, detector, count } of findings) {
    console.log(`  SENSITIVE ${detector} x${count} in ${file}`);
  }
  const flagged = [...new Set(findings.map(({ file }) => file))];
  if (quarantine) {
    for (const file of flagged) rmSync(file, { force: true });
    console.log(`EVIDENCE SCAN FAILED: ${flagged.length} file(s) removed before archiving`);
  } else {
    console.log(
      `EVIDENCE SCAN FAILED: ${flagged.length} file(s) contain unmasked sensitive values`,
    );
  }
  process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`EVIDENCE SCAN ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
