import { describe, expect, it } from 'vitest';

import { validatedMatchRanges } from '../../src/renderer/highlight';

describe('validatedMatchRanges', () => {
  it('filters invalid ranges, sorts and merges overlaps', () => {
    expect(
      validatedMatchRanges('abcdefghij', [
        { start: 4, end: 8 },
        { start: -1, end: 2 },
        { start: 2, end: 5 },
        { start: 9, end: 12 },
        { start: 8, end: 9 },
      ]),
    ).toEqual([{ start: 2, end: 9 }]);
  });

  it('keeps UTF-16 ranges used by DOM text slicing', () => {
    const text = 'كتاب 📚 مفيد';
    const start = text.indexOf('📚');
    expect(validatedMatchRanges(text, [{ start, end: start + 2 }])).toEqual([
      { start, end: start + 2 },
    ]);
  });
});
