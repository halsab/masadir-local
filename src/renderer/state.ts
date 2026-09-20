import type {
  AppSnapshot,
  BookMatch,
  BookSearchResult,
} from '../shared/contracts';

export type Route = 'home' | 'library' | 'books' | 'matches';

export interface RendererState {
  snapshot: AppSnapshot | null;
  route: Route;
  query: string;
  books: BookSearchResult[];
  booksPage: number;
  booksHasNext: boolean;
  selectedBook: BookSearchResult | null;
  matches: BookMatch[];
  matchesLimit: number;
  loading: boolean;
  error: string | null;
}

export const createRendererState = (): RendererState => ({
  snapshot: null,
  route: 'home',
  query: '',
  books: [],
  booksPage: 1,
  booksHasNext: false,
  selectedBook: null,
  matches: [],
  matchesLimit: 20,
  loading: true,
  error: null,
});

export const searchBlockReason = (state: RendererState): string | null => {
  const snapshot = state.snapshot;
  if (snapshot === null) return null;
  if (snapshot.runtimeState === 'missing') {
    return 'Компонент поиска не найден. Переустановите приложение.';
  }
  if (snapshot.runtimeState === 'incompatible') {
    return 'Компонент поиска несовместим с этой версией приложения.';
  }
  if (snapshot.indexState === 'failed') {
    return 'Поисковый индекс недоступен. Повторите индексацию книг с ошибкой.';
  }
  if (
    snapshot.runtimeState !== 'ready' ||
    snapshot.indexState === 'unknown' ||
    snapshot.indexState === 'mutating' ||
    snapshot.indexState === 'recovering' ||
    snapshot.indexState === 'needsRecovery'
  ) {
    return 'Поиск станет доступен после подготовки библиотеки.';
  }
  return null;
};

export const friendlyError = (code: string): string => {
  switch (code) {
    case 'recoll_runtime_missing':
      return 'Компонент поиска не найден. Переустановите приложение.';
    case 'recoll_runtime_incompatible':
      return 'Компонент поиска несовместим с этой версией приложения.';
    case 'library_unavailable':
      return 'Библиотека временно недоступна.';
    case 'document_open_failed':
      return 'Не удалось открыть книгу во внешнем приложении.';
    case 'io_error':
      return 'Не удалось выполнить операцию с файлами.';
    default:
      return 'Не удалось выполнить действие. Попробуйте ещё раз.';
  }
};
