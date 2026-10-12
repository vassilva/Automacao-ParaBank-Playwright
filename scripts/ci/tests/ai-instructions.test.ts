// The AI instruction files stay discoverable and consistent with the pipeline's approved sizes
// (AGENTS.md is the single source; CLAUDE.md and .github/copilot-instructions.md point to it).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (file: string) => readFileSync(file, 'utf8');
/** Collapses line wrapping so a rule split across lines still matches. */
const flat = (text: string) => text.replace(/\s+/g, ' ');

/** The approved size the Jenkinsfile enforces, e.g. `SMOKE_EXPECTED = '4'`. */
function expected(name: string): string {
  const line = read('Jenkinsfile')
    .split('\n')
    .find((l) => l.trim().startsWith(`${name} = '`));
  const value = line?.split("'")[1];
  assert.ok(value && /^[0-9]+$/.test(value), `${name} not found in the Jenkinsfile`);
  return value;
}

describe('AI instruction files', () => {
  it('CLAUDE.md imports AGENTS.md (Claude Code loads it with the project memory)', () => {
    assert.ok(read('CLAUDE.md').split('\n').includes('@AGENTS.md'));
  });

  it('.github/copilot-instructions.md points to AGENTS.md', () => {
    assert.ok(read('.github/copilot-instructions.md').includes('](../AGENTS.md)'));
  });

  for (const file of ['AGENTS.md', '.github/copilot-instructions.md']) {
    it(`${file} states the approved suite sizes the Jenkinsfile enforces`, () => {
      const text = flat(read(file));
      const sizes: [string, string][] = [
        ['Smoke', 'SMOKE_EXPECTED'],
        ['Sanity', 'SANITY_EXPECTED'],
        ['Regression', 'REGRESSION_EXPECTED'],
        ['Full', 'FULL_EXPECTED'],
        ['known defects', 'KNOWN_DEFECTS_EXPECTED'],
      ];
      for (const [label, variable] of sizes) {
        const phrase = `${label} ${expected(variable)}`;
        assert.ok(text.includes(`${phrase},`) || text.includes(`${phrase} `), `${label} differs`);
      }
      assert.ok(text.includes(`(${expected('TOTAL_SCENARIOS_EXPECTED')} total)`), 'total differs');
    });

    it(`${file} keeps the one-worker, no-retry and Sanity-manual rules`, () => {
      const text = flat(read(file)).toLowerCase();
      for (const rule of ['one worker', 'no retries', 'sanity is manual only']) {
        assert.ok(text.includes(rule), `missing rule: ${rule}`);
      }
    });
  }
});
