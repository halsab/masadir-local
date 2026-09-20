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
  stdout = 'recollindex 1.40.2';

  async run(options: ProcessRunOptions): Promise<ProcessRunResult> {
    this.calls.push(options);
    return {
      exitCode: 0,
      stdout: this.stdout,
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
    expect(
      runner.calls.every(
        (call) => call.executable === runtime.recollindexExecutable,
      ),
    ).toBe(true);
    expect(runner.calls.every((call) => call.maxStdoutBytes === 0)).toBe(true);
  });

  it('uses simple ALL TERMS mode and requests one extra book result', async () => {
    const runner = new RecordingRunner();
    runner.stdout = [
      'Recoll query: query',
      'Printing at most 0 results from first 20',
      `${Buffer.from('file:///library/a.pdf').toString('base64')} ${Buffer.from('A').toString('base64')}  ${Buffer.from('application/pdf').toString('base64')} `,
      '',
    ].join('\n');
    const adapter = new RecollAdapter({
      resolver: { resolve: async () => runtime },
      paths,
      libraryRoot: '/library',
      runner,
    });
    Object.assign(adapter, { runtime, runtimeInfo: { state: 'ready' } });

    await expect(adapter.searchBooks('safe query', 20)).resolves.toEqual([
      {
        author: '',
        mimeType: 'application/pdf',
        resultOffset: 20,
        title: 'A',
        url: 'file:///library/a.pdf',
      },
    ]);
    expect(runner.calls[0].args).toEqual([
      '-c',
      '/app/config',
      '-a',
      '-n',
      '20-21',
      '-F',
      'url title author mtype',
      '--',
      'safe query',
    ]);
    expect(runner.calls[0].timeoutMs).toBe(30_000);
  });

  it('requests bounded snippets for the saved result offset', async () => {
    const runner = new RecordingRunner();
    runner.stdout = [
      'Recoll query: query',
      'Printing at most 0 results from first 7',
      'application/pdf\t[file:///library/a.pdf]\t[A]\t10\tbytes\t',
      'SNIPPETS',
      '3 : matching text',
      '/SNIPPETS',
      '',
    ].join('\n');
    const adapter = new RecollAdapter({
      resolver: { resolve: async () => runtime },
      paths,
      libraryRoot: '/library',
      runner,
    });
    Object.assign(adapter, { runtime, runtimeInfo: { state: 'ready' } });

    await expect(adapter.searchMatches('safe query', 7, 40)).resolves.toEqual({
      mimeType: 'application/pdf',
      url: 'file:///library/a.pdf',
      snippets: [{ pageNumber: 3, snippet: 'matching text' }],
    });
    expect(runner.calls[0].args).toEqual([
      '-c',
      '/app/config',
      '-a',
      '-n',
      '7-1',
      '-A',
      '-p',
      '40',
      '--',
      'safe query',
    ]);
    expect(runner.calls[0].timeoutMs).toBe(30_000);
  });

  it('cancels only the active search process', async () => {
    const pending: Array<{
      options: ProcessRunOptions;
      resolve: (result: ProcessRunResult) => void;
    }> = [];
    const runner: ProcessRunnerPort = {
      run: (options) =>
        new Promise((resolve) => {
          pending.push({ options, resolve });
        }),
    };
    const adapter = new RecollAdapter({
      resolver: { resolve: async () => runtime },
      paths,
      libraryRoot: '/library',
      runner,
    });
    Object.assign(adapter, { runtime, runtimeInfo: { state: 'ready' } });

    const indexing = adapter.indexFile('/library/a.pdf');
    const searching = adapter.searchBooks('query', 0);
    await new Promise((resolve) => setImmediate(resolve));
    adapter.cancelSearch();

    expect(pending[0].options.signal?.aborted).toBe(false);
    expect(pending[1].options.signal?.aborted).toBe(true);
    pending[0].resolve({
      exitCode: 0,
      stdout: '',
      stderrTail: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    pending[1].resolve({
      exitCode: 0,
      stdout: 'Recoll query: query\n0 results\n',
      stderrTail: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    await expect(indexing).resolves.toBeUndefined();
    await expect(searching).resolves.toEqual([]);
  });
});
