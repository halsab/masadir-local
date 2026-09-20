import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AppError,
  ErrorCode,
  type BookMatch,
  type BookSearchResult,
  type SearchState,
  type SearchBooksPage,
} from '../../shared/contracts';
import type { IndexServiceState } from '../library/index-service';
import { isPathInside } from '../library/path-safety';
import type { StoredBook } from '../library/library-types';
import type {
  RecollBookResult,
  RecollMatchResult,
} from '../recoll/recoll-adapter';
import { findMatchRanges } from '../recoll/recoll-output-parser';
import type { Settings, SettingsService } from '../services/settings-service';
import { normalizeQuery } from './query-normalizer';

const BOOKS_PER_PAGE = 20;
const MAX_MATCHES = 200;

interface SearchRecollAdapter {
  cancelSearch(): void;
  searchBooks(
    normalizedQuery: string,
    offset: number,
  ): Promise<RecollBookResult[]>;
  searchMatches(
    normalizedQuery: string,
    resultOffset: number,
    limit: number,
  ): Promise<RecollMatchResult>;
}

interface SearchIndexState {
  getState(): IndexServiceState;
}

interface SearchLibraryCatalog {
  getSearchCatalog(): { libraryRoot: string; books: StoredBook[] };
}

interface RecentQueriesOptions {
  settings: Settings;
  settingsService: Pick<SettingsService, 'save'>;
}

interface ActiveSearchSession {
  libraryRoot: string;
  normalizedQuery: string;
  requestId: number;
  resultOffsets: Map<string, number>;
}

interface SafeBookResult {
  dto: BookSearchResult;
  resultOffset: number;
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

const cancelledError = (): AppError =>
  new AppError(ErrorCode.recollProcessFailed, 'Поиск отменён.');

export class SearchService {
  private state: SearchState = 'idle';
  private latestRequestId = 0;
  private activeSession: ActiveSearchSession | null = null;
  private recentQueriesTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly adapter: SearchRecollAdapter,
    private readonly indexState: SearchIndexState,
    private readonly library: SearchLibraryCatalog,
    private readonly recentQueries?: RecentQueriesOptions,
  ) {}

  getState(): SearchState {
    return this.state;
  }

  async searchBooks(query: string, page: number): Promise<SearchBooksPage> {
    if (!Number.isInteger(page) || page < 1) {
      throw new AppError(
        ErrorCode.invalidArgument,
        'Номер страницы некорректен.',
      );
    }
    this.assertIndexReady();

    const requestId = this.startRequest();
    this.activeSession = null;
    const normalizedQuery = normalizeQuery(query);
    if (normalizedQuery.length === 0) {
      this.setState(requestId, 'idle');
      return { page, hasNext: false, items: [] };
    }

    this.setState(requestId, 'running');
    try {
      await this.rememberQuery(normalizedQuery);
      this.assertLatest(requestId);
      const offset = (page - 1) * BOOKS_PER_PAGE;
      const results = await this.adapter.searchBooks(normalizedQuery, offset);
      this.assertLatest(requestId);

      const catalog = this.library.getSearchCatalog();
      const safeResults = this.safeBookResults(results, catalog);
      const visibleResults = safeResults.slice(0, BOOKS_PER_PAGE);
      this.activeSession = {
        libraryRoot: catalog.libraryRoot,
        normalizedQuery,
        requestId,
        resultOffsets: new Map(
          visibleResults.map(({ dto, resultOffset }) => [
            dto.bookId,
            resultOffset,
          ]),
        ),
      };
      this.setState(
        requestId,
        visibleResults.length === 0 ? 'empty' : 'results',
      );
      return {
        page,
        hasNext: safeResults.length > BOOKS_PER_PAGE,
        items: visibleResults.map(({ dto }) => dto),
      };
    } catch (error) {
      if (requestId === this.latestRequestId) {
        this.activeSession = null;
        this.state = 'failed';
      }
      throw error;
    }
  }

  async searchMatches(bookId: string, limit: number): Promise<BookMatch[]> {
    if (
      !Number.isInteger(limit) ||
      limit < 20 ||
      limit > MAX_MATCHES ||
      limit % 20 !== 0
    ) {
      throw new AppError(
        ErrorCode.invalidArgument,
        'Лимит совпадений некорректен.',
      );
    }
    this.assertIndexReady();

    const session = this.activeSession;
    if (session === null) {
      throw new AppError(
        ErrorCode.invalidArgument,
        'Активный поиск отсутствует.',
      );
    }
    const resultOffset = session.resultOffsets.get(bookId);
    if (resultOffset === undefined) {
      throw new AppError(
        ErrorCode.bookNotFound,
        'Книга отсутствует в текущей выдаче.',
      );
    }
    const catalog = this.library.getSearchCatalog();
    if (
      normalizedPathKey(catalog.libraryRoot) !==
      normalizedPathKey(session.libraryRoot)
    ) {
      throw new AppError(ErrorCode.invalidArgument, 'Активный поиск устарел.');
    }

    const requestId = this.startRequest();
    this.setState(requestId, 'running');
    try {
      const result = await this.adapter.searchMatches(
        session.normalizedQuery,
        resultOffset,
        limit,
      );
      this.assertLatest(requestId);
      const returnedBook = this.findBookForUrl(result.url, catalog);
      if (returnedBook?.bookId !== bookId || result.snippets.length > limit) {
        throw new AppError(
          ErrorCode.recollOutputInvalid,
          'Recoll вернул результат другой книги.',
        );
      }

      const matches = result.snippets.map(({ snippet, pageNumber }) => ({
        snippet,
        matchRanges: findMatchRanges(snippet, session.normalizedQuery),
        ...(pageNumber === undefined ? {} : { pageNumber }),
      }));
      this.setState(requestId, matches.length === 0 ? 'empty' : 'results');
      return matches;
    } catch (error) {
      if (requestId === this.latestRequestId) {
        this.state = 'failed';
      }
      throw error;
    }
  }

  cancel(): void {
    this.latestRequestId += 1;
    this.adapter.cancelSearch();
    if (this.state === 'running') {
      this.state = this.activeSession === null ? 'idle' : 'results';
    }
  }

  private startRequest(): number {
    this.adapter.cancelSearch();
    this.latestRequestId += 1;
    return this.latestRequestId;
  }

  private assertLatest(requestId: number): void {
    if (requestId !== this.latestRequestId) {
      throw cancelledError();
    }
  }

  private setState(requestId: number, state: SearchState): void {
    if (requestId === this.latestRequestId) {
      this.state = state;
    }
  }

  private assertIndexReady(): void {
    if (this.indexState.getState() !== 'ready') {
      throw new AppError(
        ErrorCode.libraryUnavailable,
        'Поиск недоступен во время обновления индекса.',
      );
    }
  }

  private safeBookResults(
    results: RecollBookResult[],
    catalog: ReturnType<SearchLibraryCatalog['getSearchCatalog']>,
  ): SafeBookResult[] {
    const booksByPath = new Map(
      catalog.books.map((book) => [
        normalizedPathKey(path.resolve(catalog.libraryRoot, book.relativePath)),
        book,
      ]),
    );
    const safeResults: SafeBookResult[] = [];
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
        dto: {
          bookId: book.bookId,
          title: result.title.trim() || path.basename(book.relativePath),
          ...(result.author.trim().length > 0
            ? { author: result.author.trim() }
            : {}),
          mimeType: result.mimeType,
        },
        resultOffset: result.resultOffset,
      });
    }
    return safeResults;
  }

  private findBookForUrl(
    url: string,
    catalog: ReturnType<SearchLibraryCatalog['getSearchCatalog']>,
  ): StoredBook | undefined {
    const absolutePath = resultPath(url);
    if (
      absolutePath === null ||
      !isPathInside(catalog.libraryRoot, absolutePath)
    ) {
      return undefined;
    }
    const key = normalizedPathKey(absolutePath);
    return catalog.books.find(
      (book) =>
        normalizedPathKey(
          path.resolve(catalog.libraryRoot, book.relativePath),
        ) === key,
    );
  }

  private async rememberQuery(normalizedQuery: string): Promise<void> {
    if (this.recentQueries === undefined) {
      return;
    }
    const update = async (): Promise<void> => {
      if (this.recentQueries === undefined) {
        return;
      }
      const next = [
        normalizedQuery,
        ...this.recentQueries.settings.recentQueries.filter(
          (query) => query !== normalizedQuery,
        ),
      ].slice(0, 3);
      if (
        next.length === this.recentQueries.settings.recentQueries.length &&
        next.every(
          (query, index) =>
            query === this.recentQueries?.settings.recentQueries[index],
        )
      ) {
        return;
      }
      this.recentQueries.settings.recentQueries = next;
      await this.recentQueries.settingsService.save(
        this.recentQueries.settings,
      );
    };
    const queued = this.recentQueriesTail.then(update, update);
    this.recentQueriesTail = queued.catch(() => undefined);
    await queued;
  }
}
