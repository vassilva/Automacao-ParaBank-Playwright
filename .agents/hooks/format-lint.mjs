// PostToolUse check shared by Claude Code and Codex: formats each edited .ts/.feature file with
// Prettier and lints .ts files with ESLint, using the project's own binaries and config. Exit code 2
// feeds lint errors back to the agent so it fixes them before moving on.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { editTargets, ROOT } from './edit-targets.mjs';

const event = JSON.parse(readFileSync(0, 'utf8'));
const projectDir = process.env.CLAUDE_PROJECT_DIR || ROOT;
const files = editTargets(event)
  .filter(({ deleted, relative }) => !deleted && /\.(ts|feature)$/i.test(relative))
  .map(({ absolute }) => absolute);
if (files.length === 0) process.exit(0);

function run(script, args) {
  return spawnSync(process.execPath, [path.join(projectDir, script), ...args], {
    cwd: projectDir,
    encoding: 'utf8',
  });
}

// --ignore-unknown: Prettier has no Gherkin parser here, so .feature files are skipped silently.
const prettier = run('node_modules/prettier/bin/prettier.cjs', [
  '--write',
  '--ignore-unknown',
  ...files,
]);
const problems = [];
if (prettier.status !== 0) problems.push(`Prettier failed:\n${prettier.stderr || prettier.stdout}`);

const typescript = files.filter((file) => /\.ts$/i.test(file));
if (typescript.length > 0) {
  const eslint = run('node_modules/eslint/bin/eslint.js', ['--no-warn-ignored', ...typescript]);
  if (eslint.status !== 0)
    problems.push(`ESLint found problems:\n${eslint.stdout || eslint.stderr}`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(2);
}
