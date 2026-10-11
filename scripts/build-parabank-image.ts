/**
 * Builds ParaBank from the pinned official source commit into an immutable local image.
 *
 *   npm run app:build
 *
 * - Reads the commit from docker/parabank/source.env (the single source of truth).
 * - Tags the image parabank-local:<12-char commit>. An existing tag is never overwritten, so a
 *   tag always means one image ID (build once; delete the image deliberately to rebuild).
 * - Runs the official Maven build including ParaBank's own tests (inside Docker, pinned toolchain).
 * - Writes build/parabank-build.log and build/parabank-image.json (provenance record).
 *
 * CI options (environment variables):
 * - PARABANK_IMAGE_TAG    tag to create instead of parabank-local:<commit>, e.g. one per Jenkins
 *                         build so concurrent builds never share a tag.
 * - PARABANK_BUILD_FRESH  "true" re-runs the checkout + Maven stage (and so ParaBank's tests)
 *                         instead of reusing it from the build cache; the toolchain stays cached.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DIGEST_LABEL, inputsDigest } from './ci/app-image';
import { lineRedactor } from './log-redaction';

const CONTEXT = path.join('docker', 'parabank');
const OUT_DIR = 'build';

function readPin(): { repo: string; commit: string } {
  const values = Object.fromEntries(
    readFileSync(path.join(CONTEXT, 'source.env'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
  );
  const repo = values.PARABANK_SOURCE_REPO ?? '';
  const commit = values.PARABANK_SOURCE_COMMIT ?? '';
  if (!/^https:\/\//.test(repo) || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('docker/parabank/source.env must define an https repo and a full 40-char SHA');
  }
  return { repo, commit };
}

function docker(args: string[]): string {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function imageExists(tag: string): boolean {
  return spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' }).status === 0;
}

/** Did BuildKit reuse the Maven layer instead of running it (and its tests) in this build? */
function mavenStepFromCache(log: string): boolean {
  const step = /^#(\d+) \[build[^\]]*\] RUN .*mvn --batch-mode/m.exec(log)?.[1];
  return step !== undefined && new RegExp(`^#${step} CACHED`, 'm').test(log);
}

/** Provenance files written into the image by the build stage (see the Dockerfile). */
function imageProvenance(tag: string): { warSha256: string; applicationTests: string[] } {
  const read = (file: string) =>
    docker(['run', '--rm', '--entrypoint', 'cat', tag, `/opt/parabank/provenance/${file}`]);
  return {
    warSha256: read('parabank.war.sha256').split(/\s+/)[0] ?? '',
    applicationTests: read('application-tests.txt').split(/\r?\n/),
  };
}

/** Totals reported in this build's log (used to explain a failed build). */
function testTotals(log: string) {
  const totals = (plugin: string) => {
    const sections = log.split(new RegExp(`--- ${plugin}:`)).slice(1);
    const summaries = sections
      .map((section) =>
        /Results:[\s\S]*?Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/.exec(
          section,
        ),
      )
      .filter((match): match is RegExpExecArray => match !== null);
    return summaries.map(([, run, failures, errors, skipped]) => ({
      run: Number(run),
      failures: Number(failures),
      errors: Number(errors),
      skipped: Number(skipped),
    }));
  };
  return { surefire: totals('surefire'), failsafe: totals('failsafe') };
}

async function main(): Promise<void> {
  const { repo, commit } = readPin();
  const tag = process.env.PARABANK_IMAGE_TAG?.trim() || `parabank-local:${commit.slice(0, 12)}`;
  const fresh = process.env.PARABANK_BUILD_FRESH === 'true';
  if (imageExists(tag)) {
    const id = docker(['image', 'inspect', tag, '--format', '{{.Id}}']);
    console.log(`${tag} already exists (${id}); not rebuilding. Remove it first to rebuild.`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const logPath = path.join(OUT_DIR, 'parabank-build.log');
  const log = createWriteStream(logPath);
  const started = Date.now();
  console.log(`Building ${tag} from ${repo} @ ${commit}${fresh ? ' (fresh: tests re-run)' : ''}`);

  const exitCode = await new Promise<number>((resolve) => {
    const build = spawn('docker', [
      'build',
      '--progress=plain',
      '--build-arg',
      `PARABANK_SOURCE_REPO=${repo}`,
      '--build-arg',
      `PARABANK_SOURCE_COMMIT=${commit}`,
      // The application inputs this image was built from (scripts/ci/app-image.ts): lets a later
      // pipeline reuse it instead of rebuilding when only tests or documentation changed.
      '--label',
      `${DIGEST_LABEL}=${inputsDigest()}`,
      '--tag',
      tag,
      ...(fresh ? ['--no-cache-filter', 'build'] : []),
      CONTEXT,
    ]);
    // ParaBank's own tests print its demo customer (username, password, sample SSN): every line is
    // redacted before it reaches the console (the Jenkins log) or build/parabank-build.log.
    const redactors = [build.stdout, build.stderr].map((stream) => {
      const redactor = lineRedactor((text) => {
        process.stdout.write(text);
        log.write(text);
      });
      stream.on('data', (chunk: Buffer) => redactor.push(chunk));
      return redactor;
    });
    build.on('close', (code) => {
      redactors.forEach((redactor) => redactor.flush());
      resolve(code ?? 1);
    });
  });
  await new Promise<void>((resolve) => log.end(resolve));
  const seconds = Math.round((Date.now() - started) / 1000);
  const buildLog = readFileSync(logPath, 'utf8');

  if (exitCode !== 0) {
    const tests = testTotals(buildLog);
    console.error(
      `\nBuild FAILED after ${seconds}s (see ${logPath}). Tests: ${JSON.stringify(tests)}`,
    );
    process.exit(exitCode);
  }

  const [image] = JSON.parse(docker(['image', 'inspect', tag])) as {
    Id: string;
    RepoDigests: string[];
    Created: string;
    Config: { Labels: Record<string, string> };
  }[];
  if (!image) throw new Error(`docker image inspect returned nothing for ${tag}`);
  const provenance = imageProvenance(tag);
  const record = {
    image: tag,
    imageId: image.Id,
    repoDigests: image.RepoDigests,
    created: image.Created,
    source: { repository: repo, commit },
    labels: image.Config.Labels,
    artifact: { file: 'parabank.war', sha256: provenance.warSha256 },
    buildCommand: 'mvn --batch-mode --no-transfer-progress clean install',
    // From Maven's JUnit reports, recorded inside the image when the Maven step ran.
    applicationTests: provenance.applicationTests,
    mavenStepFromCache: mavenStepFromCache(buildLog),
    buildSeconds: seconds,
  };
  writeFileSync(path.join(OUT_DIR, 'parabank-image.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nBuilt ${tag} (${image.Id}) in ${seconds}s`);
  console.log(`Artifact parabank.war sha256 ${provenance.warSha256}`);
  console.log(`Application tests: ${provenance.applicationTests.join('; ')}`);
  if (record.mavenStepFromCache) {
    console.log(
      'Maven step reused from the build cache (same inputs); test totals come from the image.',
    );
  }
  console.log(`Provenance: ${path.join(OUT_DIR, 'parabank-image.json')}`);
  console.log(
    'Deploy it (by image ID, recorded above): npm run qa:deploy, then npm run uat:deploy',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
