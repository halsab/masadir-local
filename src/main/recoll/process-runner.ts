import { spawn } from 'node:child_process';
import path from 'node:path';

export type ProcessFailureKind =
  | 'spawn-failed'
  | 'non-zero-exit'
  | 'timed-out'
  | 'aborted';

export class ProcessRunError extends Error {
  constructor(
    readonly kind: ProcessFailureKind,
    message: string,
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderrTail: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProcessRunError';
  }
}

export interface ProcessRunOptions {
  executable: string;
  args: readonly string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  shutdownGraceMs?: number;
}

export interface ProcessRunResult {
  exitCode: number;
  stdout: string;
  stderrTail: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface ProcessRunnerPort {
  run(options: ProcessRunOptions): Promise<ProcessRunResult>;
}

class BoundedTail {
  private value = Buffer.alloc(0);
  truncated = false;

  constructor(private readonly maximumBytes: number) {}

  append(chunk: Buffer): void {
    if (this.maximumBytes === 0) {
      this.truncated ||= chunk.length > 0;
      return;
    }

    const combined = Buffer.concat([this.value, chunk]);
    if (combined.length > this.maximumBytes) {
      this.truncated = true;
      this.value = combined.subarray(combined.length - this.maximumBytes);
    } else {
      this.value = combined;
    }
  }

  toString(): string {
    return this.value.toString('utf8');
  }
}

export class ProcessRunner implements ProcessRunnerPort {
  async run(options: ProcessRunOptions): Promise<ProcessRunResult> {
    if (!path.isAbsolute(options.executable)) {
      throw new ProcessRunError(
        'spawn-failed',
        'Process executable must be an absolute path.',
        null,
        null,
        '',
      );
    }

    if (options.signal?.aborted === true) {
      throw new ProcessRunError('aborted', 'Process was aborted.', null, null, '');
    }

    const stdout = new BoundedTail(options.maxStdoutBytes ?? 64 * 1024);
    const stderr = new BoundedTail(options.maxStderrBytes ?? 16 * 1024);

    return new Promise((resolve, reject) => {
      const child = spawn(options.executable, [...options.args], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let failure: 'timed-out' | 'aborted' | null = null;
      let hardKillTimer: NodeJS.Timeout | undefined;

      const stop = (reason: 'timed-out' | 'aborted'): void => {
        if (failure !== null || child.exitCode !== null || child.signalCode !== null) {
          return;
        }
        failure = reason;
        child.kill('SIGTERM');
        hardKillTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }, options.shutdownGraceMs ?? 1_500);
        hardKillTimer.unref();
      };

      const timeout =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => stop('timed-out'), options.timeoutMs);
      timeout?.unref();
      const abort = (): void => stop('aborted');
      options.signal?.addEventListener('abort', abort, { once: true });

      const cleanup = (): void => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        if (hardKillTimer !== undefined) {
          clearTimeout(hardKillTimer);
        }
        options.signal?.removeEventListener('abort', abort);
      };

      child.stdout.on('data', (chunk: Buffer) => stdout.append(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.append(chunk));
      child.once('error', (error) => {
        cleanup();
        reject(
          new ProcessRunError(
            'spawn-failed',
            'Unable to start bundled Recoll process.',
            null,
            null,
            stderr.toString(),
            { cause: error },
          ),
        );
      });
      child.once('close', (exitCode, signal) => {
        cleanup();
        if (failure !== null) {
          reject(
            new ProcessRunError(
              failure,
              failure === 'timed-out'
                ? 'Bundled Recoll process timed out.'
                : 'Bundled Recoll process was aborted.',
              exitCode,
              signal,
              stderr.toString(),
            ),
          );
          return;
        }
        if (exitCode !== 0) {
          reject(
            new ProcessRunError(
              'non-zero-exit',
              'Bundled Recoll process exited with an error.',
              exitCode,
              signal,
              stderr.toString(),
            ),
          );
          return;
        }
        resolve({
          exitCode,
          stdout: stdout.toString(),
          stderrTail: stderr.toString(),
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
        });
      });
    });
  }
}
