import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { StoredBook } from '../../src/main/library/library-types';
import type { RecollBookResult } from '../../src/main/recoll/recoll-adapter';
import { SearchService } from '../../src/main/search/search-service';

const root = path.resolve('/library');
const books: StoredBook[] = Array.from({ length: 21 }, (_, index) => ({
  bookId: `book-${index}`,
  relativePath: `book-${index}.pdf`,
  size: 1,
  mtimeMs: 1,
  mimeType: 'application/pdf',
  indexStatus: 'ready',
}));

const resultFor = (book: StoredBook, resultOffset: number): RecollBookResult => ({
  author: resultOffset === 0 ? 'Author' : '',
  mimeType: book.mimeType,
  resultOffset,
  title: resultOffset === 0 ? '' : `Title ${resultOffset}`,
  url: pathToFileURL(path.join(root, book.relativePath)).href,
});

describe('SearchService book paging', () => {
  it('returns 20 safe DTOs and uses the extra result for hasNext', async () => {
    const calls: Array<{ query: string; offset: number }> = [];
    const service = new SearchService(
      {
        searchBooks: async (query, offset) => {
          calls.push({ query, offset });
          return books.map((book, index) => resultFor(book, offset + index));
        },
      },
      { getState: () => 'ready' },
      { getSearchCatalog: () => ({ libraryRoot: root, books }) },
    );

    const page = await service.searchBooks('  query*  ', 1);

    expect(calls).toEqual([{ query: 'query', offset: 0 }]);
    expect(page.items).toHaveLength(20);
    expect(page.hasNext).toBe(true);
    expect(page.items[0]).toEqual({
      bookId: 'book-0',
      title: 'book-0.pdf',
      author: 'Author',
      mimeType: 'application/pdf',
    });
    expect(page.items[0]).not.toHaveProperty('url');
  });

  it('does not run Recoll for an empty normalized query', async () => {
    let called = false;
    const service = new SearchService(
      {
        searchBooks: async () => {
          called = true;
          return [];
        },
      },
      { getState: () => 'ready' },
      { getSearchCatalog: () => ({ libraryRoot: root, books }) },
    );

    await expect(service.searchBooks('*** ""', 2)).resolves.toEqual({
      page: 2,
      hasNext: false,
      items: [],
    });
    expect(called).toBe(false);
  });

  it('drops stale and outside-library Recoll results', async () => {
    const service = new SearchService(
      {
        searchBooks: async () => [
          resultFor(books[0], 0),
          { ...resultFor(books[1], 1), url: 'file:///outside/book.pdf' },
          { ...resultFor(books[1], 2), url: 'file:///library/missing.pdf' },
        ],
      },
      { getState: () => 'ready' },
      { getSearchCatalog: () => ({ libraryRoot: root, books }) },
    );

    await expect(service.searchBooks('query', 1)).resolves.toMatchObject({
      items: [{ bookId: 'book-0' }],
      hasNext: false,
    });
  });
});
