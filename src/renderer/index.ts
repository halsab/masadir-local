import './styles.css';

import type { BookSearchResult } from '../shared/contracts';
import { element, setBusy } from './dom';
import { renderBooks, renderHome, type SearchActions } from './render-search';
import { createRendererState, friendlyError } from './state';

const root = document.querySelector<HTMLElement>('#app');
if (root === null) throw new Error('Renderer root is missing.');

const state = createRendererState();

const render = (): void => {
  root.replaceChildren();
  setBusy(root, state.loading);
  const actions: SearchActions = {
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
  if (state.route === 'books') root.append(renderBooks(state, actions));
  else if (state.route === 'library') {
    const placeholder = element('section', 'content-view');
    placeholder.append(element('h1', undefined, 'Библиотека'));
    root.append(placeholder);
  } else root.append(renderHome(state, actions));
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
  state.error = 'Просмотр совпадений ещё загружается.';
  render();
};

const start = async (): Promise<void> => {
  await refreshSnapshot();
  state.loading = false;
  render();
};

void start();
