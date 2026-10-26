// PostToolUse check: formats an edited .ts/.feature file with Prettier and lints .ts files with
// ESLint, using the project's own binaries and config. Exit code 2 feeds lint errors back to the
// agent so it fixes them before moving on.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const event = JSON.parse(readFileSync(0, 'utf8'));
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? event.cwd ?? process.cwd();
const target = event.tool_input?.file_path;
if (typeof target !== 'string' || !/\.(ts|feature)$/i.test(target)) process.exit(0);

const file = path.resolve(projectDir, target);
if (path.relative(projectDir, file).startsWith('..')) process.exit(0);

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
  file,
]);
const problems = [];
if (prettier.status !== 0) problems.push(`Prettier failed:\n${prettier.stderr || prettier.stdout}`);

if (/\.ts$/i.test(file)) {
  const eslint = run('node_modules/eslint/bin/eslint.js', ['--no-warn-ignored', file]);
  if (eslint.status !== 0)
    problems.push(`ESLint found problems:\n${eslint.stdout || eslint.stderr}`);
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.exit(2);
}
