import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RuntimeResolver } from '../../src/main/recoll/runtime-resolver';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('RuntimeResolver', () => {
  it('resolves only the bundled development target', async () => {
    const appPath = await mkdtemp(path.join(os.tmpdir(), 'masadir-runtime-'));
    directories.push(appPath);
    const root = path.join(appPath, 'assets', 'runtime', 'darwin-arm64');
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, 'runtime-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        recollVersion: '1.40.2',
        recollindexExecutable: 'bin/recollindex',
        recollqExecutable: 'bin/recollq',
        helperDirectories: ['helpers'],
        requiredFiles: ['bin/recollindex', 'bin/recollq'],
        indexCompatibilityVersion: '1',
      }),
    );

    const runtime = await new RuntimeResolver({
      appPath,
      isPackaged: false,
      resourcesPath: '/ignored',
      platform: 'darwin',
      arch: 'arm64',
    }).resolve();

    expect(runtime.root).toBe(root);
    expect(runtime.recollindexExecutable).toBe(
      path.join(root, 'bin', 'recollindex'),
    );
  });

  it('uses the target within packaged resources and rejects other targets', () => {
    const packaged = new RuntimeResolver({
      appPath: '/ignored',
      isPackaged: true,
      resourcesPath: '/app/resources',
      platform: 'win32',
      arch: 'x64',
    });
    expect(packaged.getRuntimeRoot()).toBe(path.resolve('/app/resources/win32-x64'));

    const unsupported = new RuntimeResolver({
      appPath: '/app',
      isPackaged: false,
      resourcesPath: '/resources',
      platform: 'linux',
      arch: 'x64',
    });
    expect(() => unsupported.getTarget()).toThrow('Unsupported');
  });
});
