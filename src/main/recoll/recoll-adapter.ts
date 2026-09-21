import { constants, access, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  AppError,
  ErrorCode,
  type RuntimeState,
} from '../../shared/contracts';
import type { AppPaths } from '../platform/app-paths';
import {
  ProcessRunError,
  ProcessRunner,
  type ProcessRunnerPort,
} from './process-runner';
import {
  parseRecollFieldOutput,
  parseRecollSnippetOutput,
  type ParsedRecollSnippet,
} from './recoll-output-parser';
import { writeRecollConfig } from './recoll-config';
import type { RecollRuntime, RuntimeResolver } from './runtime-resolver';

export interface RuntimeInfo {
  state: RuntimeState;
  target?: string;
  recollVersion?: string;
  runtimeFingerprint?: string;
  indexCompatibilityVersion?: string;
}

interface RuntimeResolverPort {
  resolve(): Promise<RecollRuntime>;
}

export interface RecollAdapterOptions {
  resolver: RuntimeResolverPort | RuntimeResolver;
  paths: AppPaths;
  libraryRoot: string;
  runner?: ProcessRunnerPort;
}

const VERSION_TIMEOUT_MS = 10_000;
const SEARCH_TIMEOUT_MS = 30_000;

export interface RecollBookResult {
  author: string;
  mimeType: string;
  resultOffset: number;
  title: string;
  url: string;
}

export interface RecollMatchResult {
  mimeType: string;
  snippets: ParsedRecollSnippet[];
  url: string;
}

const createRuntimeEnvironment = (
  runtime: RecollRuntime,
): NodeJS.ProcessEnv => {
  const inheritedKeys = [
    'LANG',
    'LC_ALL',
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'TEMP',
    'TMP',
    'TMPDIR',
  ] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of inheritedKeys) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  env.PATH = [
    path.dirname(runtime.recollindexExecutable),
    ...runtime.helperDirectories,
    ...(process.platform === 'darwin' ? ['/usr/bin', '/bin'] : []),
  ].join(path.delimiter);
  return env;
};

const mapProcessError = (error: unknown): AppError => {
  if (error instanceof ProcessRunError && error.kind === 'spawn-failed') {
    return new AppError(
      ErrorCode.recollRuntimeMissing,
      'Bundled Recoll runtime недоступен.',
      { cause: error },
    );
  }
  return new AppError(
    ErrorCode.recollProcessFailed,
    'Recoll не смог обновить поисковый индекс.',
    { cause: error },
  );
};

const mapSearchProcessError = (error: unknown): AppError => {
  if (error instanceof ProcessRunError && error.kind === 'spawn-failed') {
    return new AppError(
      ErrorCode.recollRuntimeMissing,
      'Bundled Recoll runtime недоступен.',
      { cause: error },
    );
  }
  return new AppError(
    ErrorCode.recollProcessFailed,
    'Не удалось выполнить поиск.',
    {
      cause: error,
    },
  );
};

export class RecollAdapter {
  private readonly runner: ProcessRunnerPort;
  private readonly activeProcesses = new Set<AbortController>();
  private activeSearchController: AbortController | null = null;
  private runtime: RecollRuntime | null = null;
  private runtimeInfo: RuntimeInfo = { state: 'booting' };

  constructor(private readonly options: RecollAdapterOptions) {
    this.runner = options.runner ?? new ProcessRunner();
  }

  setLibraryRoot(libraryRoot: string): void {
    this.options.libraryRoot = libraryRoot;
    this.runtime = null;
    this.runtimeInfo = { state: 'booting' };
  }

  shutdown(): void {
    for (const controller of this.activeProcesses) {
      controller.abort();
    }
  }

  cancelSearch(): void {
    this.activeSearchController?.abort();
  }

  getRuntimeInfo(): RuntimeInfo {
    return { ...this.runtimeInfo };
  }

  async preflight(): Promise<RuntimeInfo> {
    this.runtimeInfo = { state: 'booting' };
    let runtime: RecollRuntime;
    try {
      runtime = await this.options.resolver.resolve();
    } catch (error) {
      this.runtimeInfo = {
        state:
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'missing'
            : 'incompatible',
      };
      return this.getRuntimeInfo();
    }

    const baseInfo: Omit<RuntimeInfo, 'state'> = {
      target: runtime.target,
      recollVersion: runtime.manifest.recollVersion,
      runtimeFingerprint: runtime.runtimeFingerprint,
      indexCompatibilityVersion: runtime.manifest.indexCompatibilityVersion,
    };

    try {
      await Promise.all(
        runtime.requiredFiles.map(async (file) => {
          const metadata = await stat(file);
          if (!metadata.isFile()) {
            throw new Error('Required runtime entry is not a file.');
          }
        }),
      );
      await Promise.all(
        runtime.helperDirectories.map(async (directory) => {
          const metadata = await stat(directory);
          if (!metadata.isDirectory()) {
            throw new Error('Runtime helper entry is not a directory.');
          }
        }),
      );
      if (process.platform !== 'win32') {
        await access(runtime.recollindexExecutable, constants.X_OK);
      }
      await Promise.all(
        [
          this.options.paths.recollConfig,
          this.options.paths.recollIndex,
          this.options.paths.runtimeTemp,
        ].map((directory) =>
          access(directory, constants.R_OK | constants.W_OK),
        ),
      );
      await writeRecollConfig(this.options.paths.recollConfig, {
        libraryRoot: this.options.libraryRoot,
        indexDirectory: this.options.paths.recollIndex,
        helperDirectories: runtime.helperDirectories,
        runtimeTempDirectory: this.options.paths.runtimeTemp,
      });
    } catch (error) {
      this.runtimeInfo = {
        ...baseInfo,
        state:
          (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'missing'
            : 'incompatible',
      };
      return this.getRuntimeInfo();
    }

    try {
      const version = await this.runProcess({
        executable: runtime.recollindexExecutable,
        args: ['-h'],
        cwd: runtime.root,
        env: createRuntimeEnvironment(runtime),
        timeoutMs: VERSION_TIMEOUT_MS,
        maxStdoutBytes: 16 * 1024,
        maxStderrBytes: 16 * 1024,
      });
      if (
        !`${version.stdout}\n${version.stderrTail}`.includes(
          runtime.manifest.recollVersion,
        )
      ) {
        this.runtimeInfo = { ...baseInfo, state: 'incompatible' };
        return this.getRuntimeInfo();
      }
    } catch (error) {
      this.runtimeInfo = {
        ...baseInfo,
        state:
          error instanceof ProcessRunError && error.kind === 'spawn-failed'
            ? 'missing'
            : 'incompatible',
      };
      return this.getRuntimeInfo();
    }

    this.runtime = runtime;
    this.runtimeInfo = { ...baseInfo, state: 'ready' };
    return this.getRuntimeInfo();
  }

  async indexFile(absolutePath: string): Promise<void> {
    await this.runIndexer([
      '-c',
      this.options.paths.recollConfig,
      '-i',
      absolutePath,
    ]);
  }

  async removeFile(absolutePath: string): Promise<void> {
    await this.runIndexer([
      '-c',
      this.options.paths.recollConfig,
      '-e',
      absolutePath,
    ]);
  }

  async updateFile(absolutePath: string): Promise<void> {
    await this.removeFile(absolutePath);
    await this.indexFile(absolutePath);
  }

  async recoverIncremental(): Promise<void> {
    await this.runIndexer(['-c', this.options.paths.recollConfig]);
  }

  async searchBooks(
    normalizedQuery: string,
    offset: number,
  ): Promise<RecollBookResult[]> {
    const runtime = await this.requireRuntime();
    try {
      const result = await this.runSearchProcess({
        executable: runtime.recollqExecutable,
        args: [
          '-c',
          this.options.paths.recollConfig,
          '-a',
          '-n',
          `${offset}-21`,
          '-F',
          'url title author mtype',
          '--',
          normalizedQuery,
        ],
        cwd: runtime.root,
        env: createRuntimeEnvironment(runtime),
        timeoutMs: SEARCH_TIMEOUT_MS,
        maxStdoutBytes: 512 * 1024,
        maxStderrBytes: 32 * 1024,
      });
      if (result.stdoutTruncated) {
        throw new AppError(
          ErrorCode.recollOutputInvalid,
          'Recoll вернул слишком большой результат.',
        );
      }
      return parseRecollFieldOutput(result.stdout, 4, offset).map(
        ({ fields, resultOffset }) => ({
          url: fields[0],
          title: fields[1],
          author: fields[2],
          mimeType: fields[3],
          resultOffset,
        }),
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw mapSearchProcessError(error);
    }
  }

  async searchMatches(
    normalizedQuery: string,
    resultOffset: number,
    limit: number,
  ): Promise<RecollMatchResult> {
    const runtime = await this.requireRuntime();
    try {
      const result = await this.runSearchProcess({
        executable: runtime.recollqExecutable,
        args: [
          '-c',
          this.options.paths.recollConfig,
          '-a',
          '-n',
          `${resultOffset}-1`,
          '-A',
          '-p',
          String(limit),
          '--',
          normalizedQuery,
        ],
        cwd: runtime.root,
        env: createRuntimeEnvironment(runtime),
        timeoutMs: SEARCH_TIMEOUT_MS,
        maxStdoutBytes: 1024 * 1024,
        maxStderrBytes: 32 * 1024,
      });
      if (result.stdoutTruncated) {
        throw new AppError(
          ErrorCode.recollOutputInvalid,
          'Recoll вернул слишком большой результат.',
        );
      }
      return parseRecollSnippetOutput(result.stdout);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw mapSearchProcessError(error);
    }
  }

  private async requireRuntime(): Promise<RecollRuntime> {
    if (this.runtimeInfo.state === 'booting') {
      await this.preflight();
    }
    if (this.runtime === null || this.runtimeInfo.state !== 'ready') {
      throw new AppError(
        this.runtimeInfo.state === 'missing'
          ? ErrorCode.recollRuntimeMissing
          : ErrorCode.recollRuntimeIncompatible,
        'Bundled Recoll runtime не готов.',
      );
    }
    return this.runtime;
  }

  private async runIndexer(args: readonly string[]): Promise<void> {
    const runtime = await this.requireRuntime();
    try {
      await this.runProcess({
        executable: runtime.recollindexExecutable,
        args,
        cwd: runtime.root,
        env: createRuntimeEnvironment(runtime),
        maxStdoutBytes: 0,
        maxStderrBytes: 32 * 1024,
      });
    } catch (error) {
      throw mapProcessError(error);
    }
  }

  private async runProcess(
    options: Omit<Parameters<ProcessRunnerPort['run']>[0], 'signal'>,
  ) {
    const controller = new AbortController();
    this.activeProcesses.add(controller);
    try {
      return await this.runner.run({ ...options, signal: controller.signal });
    } finally {
      this.activeProcesses.delete(controller);
    }
  }

  private async runSearchProcess(
    options: Omit<Parameters<ProcessRunnerPort['run']>[0], 'signal'>,
  ) {
    this.cancelSearch();
    const controller = new AbortController();
    this.activeSearchController = controller;
    this.activeProcesses.add(controller);
    try {
      return await this.runner.run({ ...options, signal: controller.signal });
    } finally {
      this.activeProcesses.delete(controller);
      if (this.activeSearchController === controller) {
        this.activeSearchController = null;
      }
    }
  }
}
