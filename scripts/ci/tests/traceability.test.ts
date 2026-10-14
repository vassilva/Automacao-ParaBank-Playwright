// The master checklist (docs/requirements-traceability.md) must count what it lists: totals are
// recomputed from the requirement rows, IDs are unique, every status is one of the vocabulary, and
// every unresolved requirement names its next action.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const STATUSES = [
  'COMPLETED',
  'READY FOR MERGE',
  'OWNER APPROVAL REQUIRED',
  'PENDING VALIDATION',
  'BLOCKED',
  'DEFERRED',
  'NOT VERIFIABLE',
] as const;

const doc = readFileSync('docs/requirements-traceability.md', 'utf8');
const rows = doc
  .split('\n')
  .filter((line) => /^\| REQ-\d+ /.test(line))
  .map((line) => {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    return { id: cells[0] ?? '', status: cells.at(-2) ?? '', action: cells.at(-1) ?? '' };
  });

describe('requirements traceability', () => {
  it('lists requirements with unique, consecutive IDs', () => {
    assert.ok(rows.length > 0);
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'duplicate ID');
    rows.forEach((row, index) => assert.equal(row.id, `REQ-${String(index + 1).padStart(2, '0')}`));
  });

  it('uses only the checklist statuses', () => {
    for (const row of rows) {
      assert.ok((STATUSES as readonly string[]).includes(row.status), `${row.id}: ${row.status}`);
    }
  });

  it('states totals that equal the rows', () => {
    const totals = /<!-- totals: (\d+) requirements; (.*?) -->/.exec(doc);
    assert.ok(totals, 'totals comment');
    assert.equal(Number(totals[1]), rows.length, 'requirement count');
    for (const part of (totals[2] ?? '').split('; ')) {
      const [, status, count] = /^(.+) (\d+)$/.exec(part) ?? [];
      const actual = rows.filter((row) => row.status === status).length;
      assert.equal(actual, Number(count), `${status ?? part}`);
    }
  });

  it('names the next action of every unresolved requirement', () => {
    for (const row of rows.filter((r) => r.status !== 'COMPLETED')) {
      assert.match(row.action, /\w/, `${row.id} has no next action`);
    }
  });

  it('keeps one prompt-library section per AI-assisted workflow', () => {
    const library = readFileSync('docs/ai/prompt-library.md', 'utf8');
    const sections = [...library.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1]));
    assert.deepEqual(sections, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const mapped = [...doc.matchAll(/^\| \d+\. .*\| (\d+)\. [^|]+\|/gm)].map((m) => Number(m[1]));
    assert.deepEqual(mapped, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
