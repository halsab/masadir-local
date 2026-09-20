export const ErrorCode = {
  invalidArgument: 'invalid_argument',
  notImplemented: 'not_implemented',
  unauthorized: 'unauthorized',
  settingsInvalid: 'settings_invalid',
  libraryUnavailable: 'library_unavailable',
  bookNotFound: 'book_not_found',
  ioError: 'io_error',
  internal: 'internal',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface SerializedAppError {
  code: ErrorCode;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}
