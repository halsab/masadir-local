import { describe, expect, it } from 'vitest';

import {
  parseDocumentOpenArgs,
  parseSearchBooksArgs,
  parseSearchMatchesArgs,
} from '../../src/main/app/ipc-validation';
import { AppError, ErrorCode } from '../../src/shared/contracts';

const expectInvalidArguments = (action: () => unknown): void => {
  try {
    action();
    throw new Error('Expected validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.invalidArgument);
  }
};

describe('IPC argument validation', () => {
  it('accepts a bounded search query and positive page', () => {
    expect(parseSearchBooksArgs(['арабский язык', 2])).toEqual([
      'арабский язык',
      2,
    ]);
  });

  it('rejects malformed search pagination without coercion', () => {
    expectInvalidArguments(() => parseSearchBooksArgs(['query', '2']));
    expectInvalidArguments(() => parseSearchBooksArgs(['query', 0]));
    expectInvalidArguments(() => parseSearchBooksArgs(['query', 1, true]));
  });

  it('limits match count', () => {
    expect(parseSearchMatchesArgs(['book-id', 500])).toEqual(['book-id', 500]);
    expectInvalidArguments(() => parseSearchMatchesArgs(['book-id', 501]));
  });

  it('accepts only positive optional document pages', () => {
    expect(parseDocumentOpenArgs(['book-id'])).toEqual(['book-id']);
    expect(parseDocumentOpenArgs(['book-id', 12])).toEqual(['book-id', 12]);
    expectInvalidArguments(() => parseDocumentOpenArgs(['book-id', -1]));
  });
});
