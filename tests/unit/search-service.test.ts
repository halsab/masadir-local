import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { StoredBook } from '../../src/main/library/library-types';
import type { RecollBookResult } from '../../src/main/recoll/recoll-adapter';
import { SearchService } from '../../src/main/search/search-service';
import type { Settings } from '../../src/main/services/settings-service';

const root = path.resolve('/library');
const books: StoredBook[] = Array.from({ length: 21 }, (_, index) => ({
  bookId: `book-${index}`,
  relativePath: `book-${index}.pdf`,
  size: 1,
  mtimeMs: 1,
  mimeType: 'application/pdf',
  indexStatus: 'ready',
}));

const resultFor = (
  book: StoredBook,
  resultOffset: number,
): RecollBookResult => ({
  author: resultOffset === 0 ? 'Author' : '',
  mimeType: book.mimeType,
  resultOffset,
  title: resultOffset === 0 ? '' : `Title ${resultOffset}`,
  url: pathToFileURL(path.join(root, book.relativePath)).href,
});

const adapter = (
  searchBooks: (query: string, offset: number) => Promise<RecollBookResult[]>,
  searchMatches: (
    query: string,
    offset: number,
    limit: number,
  ) => Promise<{
    mimeType: string;
    url: string;
    snippets: Array<{ snippet: string; pageNumber?: number }>;
  }> = async () => ({ mimeType: 'application/pdf', url: '', snippets: [] }),
  cancelSearch: () => void = () => undefined,
) => ({ cancelSearch, searchBooks, searchMatches });

describe('SearchService book paging', () => {
  it('returns 20 safe DTOs and uses the extra result for hasNext', async () => {
    const calls: Array<{ query: string; offset: number }> = [];
    const service = new SearchService(
      adapter(async (query, offset) => {
        calls.push({ query, offset });
        return books.map((book, index) => resultFor(book, offset + index));
      }),
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
      adapter(async () => {
        called = true;
        return [];
      }),
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

  it('does not start search while the index is mutating', async () => {
    let called = false;
    const service = new SearchService(
      adapter(async () => {
        called = true;
        return [];
      }),
      { getState: () => 'mutating' },
      { getSearchCatalog: () => ({ libraryRoot: root, books }) },
    );

    await expect(service.searchBooks('query', 1)).rejects.toThrow(
      'Поиск недоступен во время обновления индекса.',
    );
    expect(called).toBe(false);
  });

  it('drops stale and outside-library Recoll results', async () => {
    const service = new SearchService(
      adapter(async () => [
        resultFor(books[0], 0),
        { ...resultFor(books[1], 1), url: 'file:///outside/book.pdf' },
        { ...resultFor(books[1], 2), url: 'file:///library/missing.pdf' },
      ]),
      { getState: () => 'ready' },
      { getSearchCatalog: () => ({ libraryRoot: root, books }) },
    );

    await expect(service.searchBooks('query', 1)).resolves.toMatchObject({
      items: [{ bookId: 'book-0' }],
      hasNext: false,
    });
  });

  it('uses the saved absolute result offset and validates match DTOs', async () => {
    const matchCalls: Array<{ query: string; offset: number; limit: number }> =
      [];
    const service = new SearchService(
      adapter(
        async () => [resultFor(books[0], 40)],
        async (query, offset, limit) => {
          matchCalls.push({ query, offset, limit });
          return {
            mimeType: 'application/pdf',
            url: resultFor(books[0], 40).url,
            snippets: [
              { snippet: 'A QUERY match', pageNumber: 7 },
              { snippet: 'query without page' },
            ],
          };
        },
      ),
      { getState: () => 'ready' },
      { getSearchCatalog: () => ({ libraryRoot: root, books }) },
    );
    await service.searchBooks('query', 3);

    await expect(service.searchMatches('book-0', 40)).resolves.toEqual([
      {
        snippet: 'A QUERY match',
        pageNumber: 7,
        matchRanges: [{ start: 2, end: 7 }],
      },
      {
        snippet: 'query without page',
        matchRanges: [{ start: 0, end: 5 }],
      },
    ]);
    expect(matchCalls).toEqual([{ query: 'query', offset: 40, limit: 40 }]);
  });

  it('prevents stale responses and cancel from overwriting SearchState', async () => {
    const resolvers: Array<(results: RecollBookResult[]) => void> = [];
    let cancelCount = 0;
    const service = new SearchService(
      adapter(
        () =>
          new Promise((resolve) => {
            resolvers.push(resolve);
          }),
        undefined,
        () => {
          cancelCount += 1;
        },
      ),
      { getState: () => 'ready' },
      { getSearchCatalog: () => ({ libraryRoot: root, books }) },
    );

    const first = service.searchBooks('first', 1);
    const firstRejection = expect(first).rejects.toThrow('Поиск отменён.');
    await new Promise((resolve) => setImmediate(resolve));
    const second = service.searchBooks('second', 1);
    await new Promise((resolve) => setImmediate(resolve));
    resolvers[1]([resultFor(books[1], 0)]);
    await expect(second).resolves.toMatchObject({
      items: [{ bookId: 'book-1' }],
    });
    resolvers[0]([resultFor(books[0], 0)]);
    await firstRejection;
    expect(service.getState()).toBe('results');

    const pending = service.searchBooks('third', 1);
    await new Promise((resolve) => setImmediate(resolve));
    service.cancel();
    resolvers[2]([resultFor(books[2], 0)]);
    await expect(pending).rejects.toThrow('Поиск отменён.');
    expect(service.getState()).toBe('idle');
    expect(cancelCount).toBeGreaterThanOrEqual(4);
  });

  it('stores three unique normalized recent queries newest-first', async () => {
    const settings: Settings = {
      schemaVersion: 2,
      libraryRoot: root,
      recentQueries: ['old', 'older'],
    };
    const saved: string[][] = [];
    const service = new SearchService(
      adapter(async () => []),
      { getState: () => 'ready' },
      { getSearchCatalog: () => ({ libraryRoot: root, books }) },
      {
        settings,
        settingsService: {
          save: async (value) => {
            saved.push([...value.recentQueries]);
          },
        },
      },
    );

    await service.searchBooks(' new* ', 1);
    await service.searchBooks('old', 1);

    expect(settings.recentQueries).toEqual(['old', 'new', 'older']);
    expect(saved).toEqual([
      ['new', 'old', 'older'],
      ['old', 'new', 'older'],
    ]);
  });
});
