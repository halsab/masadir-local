import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProcessRunError, ProcessRunner } from '../../src/main/recoll/process-runner';

describe('ProcessRunner', () => {
  it('bounds stdout and keeps the stderr tail', async () => {
    const result = await new ProcessRunner().run({
      executable: path.resolve(process.execPath),
      args: [
        '-e',
        "process.stdout.write('x'.repeat(100)); process.stderr.write('0123456789')",
      ],
      env: process.env,
      maxStdoutBytes: 8,
      maxStderrBytes: 4,
    });

    expect(result.stdout).toBe('xxxxxxxx');
    expect(result.stderrTail).toBe('6789');
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
  });

  it('maps non-zero exit and timeout to stable failures', async () => {
    const runner = new ProcessRunner();
    await expect(
      runner.run({
        executable: path.resolve(process.execPath),
        args: ['-e', "process.stderr.write('failure'); process.exit(7)"],
        env: process.env,
      }),
    ).rejects.toMatchObject({
      kind: 'non-zero-exit',
      exitCode: 7,
      stderrTail: 'failure',
    } satisfies Partial<ProcessRunError>);

    await expect(
      runner.run({
        executable: path.resolve(process.execPath),
        args: ['-e', 'setInterval(() => undefined, 1000)'],
        env: process.env,
        timeoutMs: 20,
        shutdownGraceMs: 20,
      }),
    ).rejects.toMatchObject({ kind: 'timed-out' });
  });
});
