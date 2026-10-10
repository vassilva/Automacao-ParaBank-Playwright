// Application-image decision (scripts/ci/app-image.ts).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DIGEST_LABEL, REVISION_LABEL, decide, inputsDigest, type ImageInfo } from '../app-image';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const REV = 'f'.repeat(40);
const image = (
  id: string,
  digest = DIGEST,
  revision = REV,
  created = '2026-10-10T10:00:00Z',
): ImageInfo => ({
  id: `sha256:${id.repeat(64).slice(0, 64)}`,
  created,
  labels: { [DIGEST_LABEL]: digest, [REVISION_LABEL]: revision },
});

describe('decide()', () => {
  it('REUSE when QA runs a healthy image built from the same inputs and revision', () => {
    const qaImage = image('1');
    const d = decide(DIGEST, REV, { state: 'running', health: 'healthy', image: qaImage }, [
      qaImage,
    ]);
    assert.equal(d.action, 'REUSE');
    assert.equal(d.imageId, qaImage.id);
  });

  it('DEPLOY (no build) when QA is unhealthy but a matching image exists', () => {
    const qaImage = image('1');
    const d = decide(DIGEST, REV, { state: 'running', health: 'unhealthy', image: qaImage }, [
      qaImage,
    ]);
    assert.equal(d.action, 'DEPLOY');
  });

  it('DEPLOY the newest matching image when QA runs another one', () => {
    const other = image('2', `sha256:${'b'.repeat(64)}`);
    const older = image('3', DIGEST, REV, '2026-10-01T00:00:00Z');
    const newer = image('4', DIGEST, REV, '2026-10-09T00:00:00Z');
    const d = decide(DIGEST, REV, { state: 'running', health: 'healthy', image: other }, [
      older,
      newer,
    ]);
    assert.equal(d.action, 'DEPLOY');
    assert.equal(d.imageId, newer.id);
  });

  it('BUILD when the application inputs changed (no image carries the new digest)', () => {
    const qaImage = image('1', `sha256:${'c'.repeat(64)}`);
    const d = decide(DIGEST, REV, { state: 'running', health: 'healthy', image: qaImage }, []);
    assert.equal(d.action, 'BUILD');
    assert.equal(d.imageId, '');
  });

  it('never reuses an image without the digest label (unknown provenance)', () => {
    const unlabeled: ImageInfo = {
      id: `sha256:${'9'.repeat(64)}`,
      labels: { [REVISION_LABEL]: REV },
    };
    const d = decide(DIGEST, REV, { state: 'running', health: 'healthy', image: unlabeled }, [
      unlabeled,
    ]);
    assert.equal(d.action, 'BUILD');
  });

  it('never reuses an image of another source revision', () => {
    const wrongRev = image('5', DIGEST, '0'.repeat(40));
    const d = decide(DIGEST, REV, { state: 'running', health: 'healthy', image: wrongRev }, [
      wrongRev,
    ]);
    assert.equal(d.action, 'BUILD');
  });
});

describe('inputsDigest()', () => {
  it('is a stable sha256 of this checkout', () => {
    assert.match(inputsDigest(), /^sha256:[0-9a-f]{64}$/);
    assert.equal(inputsDigest(), inputsDigest());
  });
});
