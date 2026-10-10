/**
 * Which ParaBank application image a pipeline validates, decided explicitly and deterministically.
 *
 * This repository is mostly test automation. The application image is a function of its build
 * inputs only: docker/parabank/** (Dockerfile and the pinned source commit) and the build script.
 * Their SHA-256 ("inputs digest") is recorded on every image this project builds (label
 * parabank.inputs.digest). A change to tests or documentation does not change the digest, so it
 * must not rebuild or redeploy the application.
 *
 *   ts-node scripts/ci/app-image.ts digest     print the inputs digest of this checkout
 *   ts-node scripts/ci/app-image.ts resolve    print the decision as KEY=value lines (Jenkins)
 *
 * Decision (decide()), for the QA environment:
 *   REUSE   QA runs, is healthy, and its image carries this digest and the pinned revision:
 *           validate that image in place (no build, no deployment).
 *   DEPLOY  QA does not run such an image, but a local image built from these inputs exists:
 *           deploy it (no build).
 *   BUILD   no image from these inputs exists: build once, then deploy it.
 * Whatever the action, the image ID is then checked on QA (identity), validated there, and is the
 * only image a main build can promote to UAT. Images built before the label existed are never
 * reused: unknown provenance means BUILD.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const DIGEST_LABEL = 'parabank.inputs.digest';
export const REVISION_LABEL = 'org.opencontainers.image.revision';
const INPUT_DIRS = [path.join('docker', 'parabank')];
const INPUT_FILES = [path.join('scripts', 'build-parabank-image.ts')];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

/** SHA-256 over the build inputs: sorted POSIX paths and LF-normalized contents. */
export function inputsDigest(root = '.'): string {
  const files = [
    ...INPUT_DIRS.flatMap((d) => filesUnder(path.join(root, d))),
    ...INPUT_FILES.map((f) => path.join(root, f)),
  ]
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export interface ImageInfo {
  id: string;
  created?: string;
  labels: Record<string, string>;
}
export interface QaState {
  state: string;
  health: string;
  image?: ImageInfo;
}
export interface Decision {
  action: 'REUSE' | 'DEPLOY' | 'BUILD';
  imageId: string;
  reason: string;
}

const matches = (image: ImageInfo | undefined, digest: string, revision: string): boolean =>
  !!image && image.labels[DIGEST_LABEL] === digest && image.labels[REVISION_LABEL] === revision;

export function decide(
  digest: string,
  revision: string,
  qa: QaState,
  local: ImageInfo[],
): Decision {
  if (qa.state === 'running' && qa.health === 'healthy' && matches(qa.image, digest, revision)) {
    return {
      action: 'REUSE',
      imageId: qa.image!.id,
      reason: 'QA already runs a healthy image built from these application inputs',
    };
  }
  const candidates = local
    .filter((image) => matches(image, digest, revision))
    .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));
  if (candidates[0]) {
    return {
      action: 'DEPLOY',
      imageId: candidates[0].id,
      reason: `an image built from these application inputs exists; QA is ${qa.state}/${qa.health} or runs another image`,
    };
  }
  return {
    action: 'BUILD',
    imageId: '',
    reason: 'no image built from these application inputs exists',
  };
}

function docker(args: string[]): string {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function imageInfo(ref: string): ImageInfo | undefined {
  const raw = docker(['image', 'inspect', ref, '--format', '{{json .}}']);
  if (!raw) return undefined;
  const image = JSON.parse(raw) as {
    Id: string;
    Created: string;
    Config: { Labels: Record<string, string> | null };
  };
  return { id: image.Id, created: image.Created, labels: image.Config.Labels ?? {} };
}

function pinnedRevision(): string {
  const line = readFileSync(path.join('docker', 'parabank', 'source.env'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('PARABANK_SOURCE_COMMIT='));
  return line?.slice('PARABANK_SOURCE_COMMIT='.length).trim() ?? '';
}

function resolve(): Decision & { digest: string } {
  const digest = inputsDigest();
  const revision = pinnedRevision();
  const container = 'parabank-qa-parabank-1';
  const state =
    docker(['container', 'inspect', container, '--format', '{{.State.Status}}']) || 'absent';
  const health =
    docker([
      'container',
      'inspect',
      container,
      '--format',
      '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
    ]) || 'none';
  const qaImageId = docker(['container', 'inspect', container, '--format', '{{.Image}}']);
  const qa: QaState = { state, health, image: qaImageId ? imageInfo(qaImageId) : undefined };
  const ids = docker([
    'image',
    'ls',
    '--no-trunc',
    '--quiet',
    '--filter',
    `label=${DIGEST_LABEL}=${digest}`,
  ])
    .split('\n')
    .filter(Boolean);
  const local = [...new Set(ids)].map(imageInfo).filter((i): i is ImageInfo => !!i);
  return { ...decide(digest, revision, qa, local), digest };
}

if (require.main === module) {
  const command = process.argv[2];
  if (command === 'digest') {
    console.log(inputsDigest());
  } else if (command === 'resolve') {
    const d = resolve();
    console.log(`APP_IMAGE_ACTION=${d.action}`);
    console.log(`APP_IMAGE_ID=${d.imageId}`);
    console.log(`APP_INPUTS_DIGEST=${d.digest}`);
    console.log(`APP_IMAGE_REASON=${d.reason}`);
  } else {
    console.error('Usage: app-image.ts digest|resolve');
    process.exit(1);
  }
}
