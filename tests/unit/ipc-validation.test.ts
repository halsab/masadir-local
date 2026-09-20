import { describe, expect, it } from 'vitest';

import {
  parseDocumentOpenArgs,
  parseClipboardWriteArgs,
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
    expect(parseSearchMatchesArgs(['book-id', 20])).toEqual(['book-id', 20]);
    expect(parseSearchMatchesArgs(['book-id', 200])).toEqual(['book-id', 200]);
    expectInvalidArguments(() => parseSearchMatchesArgs(['book-id', 21]));
    expectInvalidArguments(() => parseSearchMatchesArgs(['book-id', 220]));
  });

  it('accepts only positive optional document pages', () => {
    expect(parseDocumentOpenArgs(['book-id'])).toEqual(['book-id']);
    expect(parseDocumentOpenArgs(['book-id', 12])).toEqual(['book-id', 12]);
    expectInvalidArguments(() => parseDocumentOpenArgs(['book-id', -1]));
  });

  it('bounds clipboard text without exposing further clipboard operations', () => {
    expect(parseClipboardWriteArgs(['цитата'])).toEqual(['цитата']);
    expectInvalidArguments(() => parseClipboardWriteArgs(['a'.repeat(1_000_001)]));
  });
});
