import { describe, expect, it } from 'vitest';

import {
  createRuntimeFingerprint,
  parseRuntimeManifest,
} from '../../src/main/recoll/runtime-manifest';

const validManifest = {
  schemaVersion: 1,
  recollVersion: '1.40.2',
  recollindexExecutable: 'bin/recollindex',
  recollqExecutable: 'bin/recollq',
  helperDirectories: ['share/recoll/filters'],
  requiredFiles: [
    'bin/recollindex',
    'bin/recollq',
    'share/recoll/filters/rclpdf.py',
  ],
  indexCompatibilityVersion: '1',
};

describe('runtime manifest', () => {
  it('validates and fingerprints significant runtime metadata', () => {
    const manifest = parseRuntimeManifest(validManifest);

    expect(manifest).toEqual(validManifest);
    expect(createRuntimeFingerprint(manifest)).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      createRuntimeFingerprint({ ...manifest, recollVersion: '1.41.0' }),
    ).not.toBe(createRuntimeFingerprint(manifest));
  });

  it('rejects escaping paths and incomplete required files', () => {
    expect(() =>
      parseRuntimeManifest({
        ...validManifest,
        recollindexExecutable: '../recollindex',
      }),
    ).toThrow('invalid');
    expect(() =>
      parseRuntimeManifest({
        ...validManifest,
        requiredFiles: ['bin/recollindex'],
      }),
    ).toThrow('required files');
  });
});
