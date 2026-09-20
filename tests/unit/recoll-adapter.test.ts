import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppPaths } from '../../src/main/platform/app-paths';
import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunnerPort,
} from '../../src/main/recoll/process-runner';
import { RecollAdapter } from '../../src/main/recoll/recoll-adapter';
import type { RecollRuntime } from '../../src/main/recoll/runtime-resolver';

class RecordingRunner implements ProcessRunnerPort {
  calls: ProcessRunOptions[] = [];

  async run(options: ProcessRunOptions): Promise<ProcessRunResult> {
    this.calls.push(options);
    return {
      exitCode: 0,
      stdout: 'recollindex 1.40.2',
      stderrTail: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    };
  }
}

const paths: AppPaths = {
  root: '/app',
  settingsFile: '/app/settings.json',
  libraryStateFile: '/app/state.json',
  recollConfig: '/app/config',
  recollIndex: '/app/index',
  logs: '/app/logs',
  runtimeTemp: '/app/temp',
};

const runtime: RecollRuntime = {
  target: 'darwin-arm64',
  root: '/runtime',
  manifestPath: '/runtime/runtime-manifest.json',
  manifest: {
    schemaVersion: 1,
    recollVersion: '1.40.2',
    recollindexExecutable: 'bin/recollindex',
    recollqExecutable: 'bin/recollq',
    helperDirectories: ['helpers'],
    requiredFiles: ['bin/recollindex', 'bin/recollq'],
    indexCompatibilityVersion: '1',
  },
  recollindexExecutable: '/runtime/bin/recollindex',
  recollqExecutable: '/runtime/bin/recollq',
  helperDirectories: ['/runtime/helpers'],
  requiredFiles: ['/runtime/bin/recollindex', '/runtime/bin/recollq'],
  runtimeFingerprint: 'fingerprint',
};

describe('RecollAdapter commands', () => {
  it('uses fixed executable and exact add, erase, update and recovery args', async () => {
    const runner = new RecordingRunner();
    const adapter = new RecollAdapter({
      resolver: { resolve: async () => runtime },
      paths,
      libraryRoot: '/library',
      runner,
    });
    // Командные аргументы проверяются отдельно от preflight файловой системы.
    Object.assign(adapter, {
      runtime,
      runtimeInfo: { state: 'ready' },
    });
    const book = path.resolve('/library/a book.pdf');

    await adapter.indexFile(book);
    await adapter.removeFile(book);
    await adapter.updateFile(book);
    await adapter.recoverIncremental();

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['-c', '/app/config', '-i', book],
      ['-c', '/app/config', '-e', book],
      ['-c', '/app/config', '-e', book],
      ['-c', '/app/config', '-i', book],
      ['-c', '/app/config'],
    ]);
    expect(runner.calls.every((call) => call.executable === runtime.recollindexExecutable)).toBe(true);
    expect(runner.calls.every((call) => call.maxStdoutBytes === 0)).toBe(true);
  });
});
