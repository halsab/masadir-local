import './styles.css';

import type { BookMatch, BookSearchResult } from '../shared/contracts';
import { element, setBusy } from './dom';
import { renderLibrary, type LibraryActions } from './render-library';
import { renderMatches, type MatchActions } from './render-matches';
import { renderBooks, renderHome, type SearchActions } from './render-search';
import { createRendererState, friendlyError } from './state';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) throw new Error('Renderer root is missing.');

const state = createRendererState();

const render = (): void => {
  root.replaceChildren();
  setBusy(root, state.loading);
  const actions: SearchActions = {
    addBooks: () => void runLibraryAction(() => window.masadir.library.addBooks()),
    chooseRoot: () => void runLibraryAction(() => window.masadir.library.chooseRoot()),
    openLibrary: () => {
      state.route = 'library';
      render();
    },
    openMatches: (book) => void openMatches(book),
    search: (query, page) => {
      if (page === 0) {
        state.route = 'home';
        state.query = '';
        state.books = [];
        render();
        return;
      }
      void search(query, page);
    },
  };
  const libraryActions: LibraryActions = {
    addBooks: () => void runLibraryAction(() => window.masadir.library.addBooks()),
    chooseRoot: () => void runLibraryAction(() => window.masadir.library.chooseRoot()),
    goHome: () => {
      state.route = 'home';
      render();
    },
    openFolder: () => void runAction(() => window.masadir.library.openFolder()),
    retryIndex: (bookId) => void runLibraryAction(() => window.masadir.library.retryIndex(bookId)),
    trashBook: (bookId) => void runLibraryAction(() => window.masadir.library.trashBook(bookId)),
  };
  const matchActions: MatchActions = {
    back: () => {
      state.route = 'books';
      state.error = null;
      render();
    },
    copy: (match, target) => void copyMatch(match, target),
    loadMore: () => void loadMatches(state.matchesLimit + 20),
    open: (match) => void openDocument(match),
  };
  if (state.route === 'books') root.append(renderBooks(state, actions));
  else if (state.route === 'library') root.append(renderLibrary(state, libraryActions));
  else if (state.route === 'matches') root.append(renderMatches(state, matchActions));
  else root.append(renderHome(state, actions));
  if (state.loading) {
    const loading = element('div', 'loading-line', 'Загрузка…');
    loading.setAttribute('role', 'status');
    root.append(loading);
  }
  if (state.error !== null) {
    const error = element('p', 'error-banner', state.error);
    error.setAttribute('role', 'alert');
    root.append(error);
  }
};

const refreshSnapshot = async (): Promise<void> => {
  const result = await window.masadir.app.getSnapshot();
  if (result.ok) state.snapshot = result.value;
  else state.error = friendlyError(result.error.code);
};

const search = async (query: string, page: number): Promise<void> => {
  state.query = query;
  state.booksPage = page;
  state.route = 'books';
  state.loading = true;
  state.error = null;
  render();
  const result = await window.masadir.search.searchBooks(query, page);
  if (result.ok) {
    state.books = result.value.items;
    state.booksHasNext = result.value.hasNext;
    await refreshSnapshot();
  } else {
    state.books = [];
    state.booksHasNext = false;
    state.error = friendlyError(result.error.code);
  }
  state.loading = false;
  render();
};

const openMatches = async (book: BookSearchResult): Promise<void> => {
  state.selectedBook = book;
  state.route = 'matches';
  state.matches = [];
  state.matchesLimit = 20;
  await loadMatches(20);
};

const loadMatches = async (limit: number): Promise<void> => {
  const book = state.selectedBook;
  if (book === null) return;
  state.loading = true;
  state.error = null;
  render();
  const result = await window.masadir.search.searchMatches(book.bookId, limit);
  if (result.ok) {
    state.matches = result.value;
    state.matchesLimit = limit;
  } else {
    state.error = friendlyError(result.error.code);
  }
  state.loading = false;
  render();
};

const runAction = async <T>(action: () => Promise<{ ok: true; value: T } | { ok: false; error: { code: string } }>): Promise<boolean> => {
  state.loading = true;
  state.error = null;
  render();
  const result = await action();
  if (!result.ok) state.error = friendlyError(result.error.code);
  state.loading = false;
  render();
  return result.ok;
};

const runLibraryAction = async <T>(
  action: () => Promise<{ ok: true; value: T } | { ok: false; error: { code: string } }>,
): Promise<void> => {
  const succeeded = await runAction(action);
  if (succeeded) await refreshSnapshot();
  render();
};

const openDocument = async (match: BookMatch): Promise<void> => {
  const bookId = state.selectedBook?.bookId;
  if (bookId === undefined) return;
  await runAction(() => window.masadir.document.open(bookId, match.pageNumber));
};

const copyMatch = async (
  match: BookMatch,
  target: HTMLButtonElement,
): Promise<void> => {
  const result = await window.masadir.clipboard.writeText(match.snippet);
  if (result.ok) {
    target.textContent = 'Скопировано';
  } else {
    state.error = friendlyError(result.error.code);
    render();
  }
};

const start = async (): Promise<void> => {
  const refreshFromEvent = (): void => {
    void (async () => {
      await refreshSnapshot();
      render();
    })();
  };
  const unsubscribeBook = window.masadir.events.onBookStatusChanged(refreshFromEvent);
  const unsubscribeIndex = window.masadir.events.onIndexStateChanged(refreshFromEvent);
  window.addEventListener('beforeunload', () => {
    unsubscribeBook();
    unsubscribeIndex();
  }, { once: true });
  await refreshSnapshot();
  state.loading = false;
  render();
};

void start();
