import { describe, expect, it } from 'vitest';

import { findAvailableFileName } from '../../src/main/library/library-files';

describe('findAvailableFileName', () => {
  it('keeps a free name and proposes the first numbered conflict name', () => {
    expect(findAvailableFileName('Book.pdf', [])).toBe('Book.pdf');
    expect(
      findAvailableFileName('Book.pdf', [
        'book.PDF',
        'Book (2).pdf',
        'Book (3).PDF',
      ]),
    ).toBe('Book (4).pdf');
  });

  it('preserves Unicode, spaces and compound stems', () => {
    expect(findAvailableFileName('مصادر قديمة.docx', ['مصادر قديمة.docx'])).toBe(
      'مصادر قديمة (2).docx',
    );
  });
});
