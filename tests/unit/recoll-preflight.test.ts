import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppPaths } from '../../src/main/platform/app-paths';
import type { ProcessRunnerPort } from '../../src/main/recoll/process-runner';
import { RecollAdapter } from '../../src/main/recoll/recoll-adapter';
import type { RecollRuntime } from '../../src/main/recoll/runtime-resolver';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('RecollAdapter preflight', () => {
  it('checks files, helpers, app directories and the executable version', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'masadir-preflight-'));
    directories.push(root);
    const runtimeRoot = path.join(root, 'runtime');
    const executable = path.join(runtimeRoot, 'bin', 'recollindex');
    const recollq = path.join(runtimeRoot, 'bin', 'recollq');
    const helpers = path.join(runtimeRoot, 'helpers');
    const appRoot = path.join(root, 'app');
    const paths: AppPaths = {
      root: appRoot,
      settingsFile: path.join(appRoot, 'settings.json'),
      libraryStateFile: path.join(appRoot, 'state.json'),
      recollConfig: path.join(appRoot, 'config'),
      recollIndex: path.join(appRoot, 'index'),
      logs: path.join(appRoot, 'logs'),
      runtimeTemp: path.join(appRoot, 'temp'),
    };
    await Promise.all([
      mkdir(path.dirname(executable), { recursive: true }),
      mkdir(helpers, { recursive: true }),
      mkdir(paths.recollConfig, { recursive: true }),
      mkdir(paths.recollIndex, { recursive: true }),
      mkdir(paths.runtimeTemp, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(executable, ''),
      writeFile(recollq, ''),
    ]);
    await chmod(executable, 0o700);
    const runtime: RecollRuntime = {
      target: 'darwin-arm64',
      root: runtimeRoot,
      manifestPath: path.join(runtimeRoot, 'runtime-manifest.json'),
      manifest: {
        schemaVersion: 1,
        recollVersion: '1.40.2',
        recollindexExecutable: 'bin/recollindex',
        recollqExecutable: 'bin/recollq',
        helperDirectories: ['helpers'],
        requiredFiles: ['bin/recollindex', 'bin/recollq'],
        indexCompatibilityVersion: '1',
      },
      recollindexExecutable: executable,
      recollqExecutable: recollq,
      helperDirectories: [helpers],
      requiredFiles: [executable, recollq],
      runtimeFingerprint: 'fingerprint',
    };
    const runner: ProcessRunnerPort = {
      run: async (options) => {
        expect(options.args).toEqual(['-h']);
        return {
          exitCode: 0,
          stdout: 'Recoll 1.40.2',
          stderrTail: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        };
      },
    };
    const adapter = new RecollAdapter({
      resolver: { resolve: async () => runtime },
      paths,
      libraryRoot: path.join(root, 'library'),
      runner,
    });

    await expect(adapter.preflight()).resolves.toEqual({
      state: 'ready',
      target: 'darwin-arm64',
      recollVersion: '1.40.2',
      runtimeFingerprint: 'fingerprint',
      indexCompatibilityVersion: '1',
    });
  });
});
