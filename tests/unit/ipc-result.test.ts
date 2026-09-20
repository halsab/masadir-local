import { describe, expect, it } from 'vitest';

import {
  AppError,
  ErrorCode,
  toIpcErrorResult,
} from '../../src/shared/contracts';

describe('AppError IPC mapping', () => {
  it('preserves public application errors', () => {
    expect(
      toIpcErrorResult(
        new AppError(ErrorCode.invalidArgument, 'Некорректное значение.'),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: ErrorCode.invalidArgument,
        message: 'Некорректное значение.',
      },
    });
  });

  it('does not expose unexpected error details', () => {
    const result = toIpcErrorResult(new Error('secret internal details'));

    expect(result.error.code).toBe(ErrorCode.internal);
    expect(result.error.message).not.toContain('secret');
  });
});
