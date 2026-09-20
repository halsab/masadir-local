import { AppError, ErrorCode } from '../../shared/contracts';

const invalidArguments = (): never => {
  throw new AppError(
    ErrorCode.invalidArgument,
    'Переданы некорректные аргументы.',
  );
};

const assertArgumentCount = (
  args: unknown[],
  minimum: number,
  maximum = minimum,
): void => {
  if (args.length < minimum || args.length > maximum) {
    invalidArguments();
  }
};

const parseNonEmptyString = (value: unknown, maximumLength: number): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    return invalidArguments();
  }

  return value;
};

const parsePositiveInteger = (value: unknown, maximum: number): number => {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maximum
  ) {
    return invalidArguments();
  }

  return value as number;
};

export const parseNoArgs = (args: unknown[]): [] => {
  assertArgumentCount(args, 0);
  return [];
};

export const parseBookIdArgs = (args: unknown[]): [bookId: string] => {
  assertArgumentCount(args, 1);
  return [parseNonEmptyString(args[0], 256)];
};

export const parseSearchBooksArgs = (
  args: unknown[],
): [query: string, page: number] => {
  assertArgumentCount(args, 2);
  return [
    parseNonEmptyString(args[0], 2_000),
    parsePositiveInteger(args[1], 1_000_000),
  ];
};

export const parseSearchMatchesArgs = (
  args: unknown[],
): [bookId: string, limit: number] => {
  assertArgumentCount(args, 2);
  const limit = parsePositiveInteger(args[1], 200);
  if (limit % 20 !== 0) {
    return invalidArguments();
  }
  return [parseNonEmptyString(args[0], 256), limit];
};

export const parseDocumentOpenArgs = (
  args: unknown[],
): [bookId: string, pageNumber?: number] => {
  assertArgumentCount(args, 1, 2);
  const bookId = parseNonEmptyString(args[0], 256);

  if (args[1] === undefined) {
    return [bookId];
  }

  return [bookId, parsePositiveInteger(args[1], 1_000_000)];
};

export const parseClipboardWriteArgs = (args: unknown[]): [text: string] => {
  assertArgumentCount(args, 1);

  if (typeof args[0] !== 'string' || args[0].length > 1_000_000) {
    return invalidArguments();
  }

  return [args[0]];
};
