import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AppError,
  ErrorCode,
  type BookSearchResult,
  type SearchBooksPage,
} from '../../shared/contracts';
import type { IndexServiceState } from '../library/index-service';
import { isPathInside } from '../library/path-safety';
import type { StoredBook } from '../library/library-types';
import type { RecollBookResult } from '../recoll/recoll-adapter';
import { normalizeQuery } from './query-normalizer';

const BOOKS_PER_PAGE = 20;

interface SearchRecollAdapter {
  searchBooks(normalizedQuery: string, offset: number): Promise<RecollBookResult[]>;
}

interface SearchIndexState {
  getState(): IndexServiceState;
}

interface SearchLibraryCatalog {
  getSearchCatalog(): { libraryRoot: string; books: StoredBook[] };
}

const normalizedPathKey = (value: string): string => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const resultPath = (urlValue: string): string | null => {
  try {
    const url = new URL(urlValue);
    if (
      url.protocol !== 'file:' ||
      (url.hostname !== '' && url.hostname !== 'localhost') ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null;
    }
    return path.resolve(fileURLToPath(url));
  } catch {
    return null;
  }
};

export class SearchService {
  constructor(
    private readonly adapter: SearchRecollAdapter,
    private readonly indexState: SearchIndexState,
    private readonly library: SearchLibraryCatalog,
  ) {}

  async searchBooks(query: string, page: number): Promise<SearchBooksPage> {
    if (!Number.isInteger(page) || page < 1) {
      throw new AppError(ErrorCode.invalidArgument, 'Номер страницы некорректен.');
    }
    if (this.indexState.getState() !== 'ready') {
      throw new AppError(
        ErrorCode.libraryUnavailable,
        'Поиск недоступен во время обновления индекса.',
      );
    }

    const normalizedQuery = normalizeQuery(query);
    if (normalizedQuery.length === 0) {
      return { page, hasNext: false, items: [] };
    }

    const offset = (page - 1) * BOOKS_PER_PAGE;
    const results = await this.adapter.searchBooks(normalizedQuery, offset);
    const catalog = this.library.getSearchCatalog();
    const booksByPath = new Map(
      catalog.books.map((book) => [
        normalizedPathKey(path.resolve(catalog.libraryRoot, book.relativePath)),
        book,
      ]),
    );

    const safeResults: BookSearchResult[] = [];
    for (const result of results) {
      const absolutePath = resultPath(result.url);
      if (
        absolutePath === null ||
        !isPathInside(catalog.libraryRoot, absolutePath)
      ) {
        continue;
      }
      const book = booksByPath.get(normalizedPathKey(absolutePath));
      if (book === undefined) {
        continue;
      }
      safeResults.push({
        bookId: book.bookId,
        title: result.title.trim() || path.basename(book.relativePath),
        ...(result.author.trim().length > 0
          ? { author: result.author.trim() }
          : {}),
        mimeType: result.mimeType,
      });
    }

    return {
      page,
      hasNext: safeResults.length > BOOKS_PER_PAGE,
      items: safeResults.slice(0, BOOKS_PER_PAGE),
    };
  }
}
