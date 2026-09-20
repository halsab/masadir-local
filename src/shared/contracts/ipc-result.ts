import { AppError, ErrorCode, type SerializedAppError } from './errors';

export type IpcResult<T> = { ok: true; value: T } | IpcErrorResult;

export interface IpcErrorResult {
  ok: false;
  error: SerializedAppError;
}

export const toIpcResult = <T>(value: T): IpcResult<T> => ({
  ok: true,
  value,
});

export const toIpcErrorResult = (error: unknown): IpcErrorResult => {
  if (error instanceof AppError) {
    return {
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }

  return {
    ok: false,
    error: {
      code: ErrorCode.internal,
      message: 'Произошла внутренняя ошибка приложения.',
    },
  };
};
