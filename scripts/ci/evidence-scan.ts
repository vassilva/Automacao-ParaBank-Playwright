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
 * otherwise match the shapes by chance. Binary files are not scanned (screenshots are masked when
 * they are taken). Output names files, detectors and counts, never a value.
 *
 * Exit 1 when anything is found. --quarantine also deletes the flagged files, so the build archives
 * the rest of its evidence without them. Exit 2 on a usage or read error (fail closed).
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
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

export interface Finding {
  file: string;
  detector: string;
  count: number;
}

/** Findings in one text, by detector (counts only). */
export function scanText(text: string): { detector: string; count: number }[] {
  const scannable = text.replace(BASE64_RUN, ' ');
  return Object.entries(DETECTORS)
    .map(([detector, pattern]) => ({ detector, count: scannable.match(pattern)?.length ?? 0 }))
    .filter(({ count }) => count > 0);
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
      if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
        skipped++;
        continue;
      }
      scanned++;
      for (const hit of scanText(readFileSync(file, 'utf8'))) findings.push({ file, ...hit });
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
  console.log(`EVIDENCE SCAN: ${scanned} text file(s) scanned, ${skipped} binary file(s) skipped`);
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
