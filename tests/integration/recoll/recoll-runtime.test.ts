import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createAppPaths, ensureAppPaths } from '../../../src/main/platform/app-paths';
import { RecollAdapter } from '../../../src/main/recoll/recoll-adapter';
import { RuntimeResolver } from '../../../src/main/recoll/runtime-resolver';

const target =
  process.platform === 'darwin' && process.arch === 'arm64'
    ? 'darwin-arm64'
    : process.platform === 'win32' && process.arch === 'x64'
      ? 'win32-x64'
      : null;
const repositoryRoot = path.resolve(__dirname, '../../..');
const runtimeRoot =
  target === null
    ? ''
    : path.join(repositoryRoot, 'assets', 'runtime', target);
const runtimeAvailable =
  target !== null && existsSync(path.join(runtimeRoot, 'runtime-manifest.json'));
const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe.skipIf(!runtimeAvailable)('bundled Recoll runtime', () => {
  it('passes preflight and incremental recovery with an isolated config', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'masadir-recoll-'));
    temporaryDirectories.push(temporaryRoot);
    const libraryRoot = path.join(temporaryRoot, 'library');
    await mkdir(libraryRoot);
    const paths = createAppPaths(temporaryRoot);
    await ensureAppPaths(paths);
    const adapter = new RecollAdapter({
      resolver: new RuntimeResolver({
        appPath: repositoryRoot,
        isPackaged: false,
        resourcesPath: '/unused',
      }),
      paths,
      libraryRoot,
    });

    await expect(adapter.preflight()).resolves.toMatchObject({ state: 'ready' });
    await expect(adapter.recoverIncremental()).resolves.toBeUndefined();
  });
});
