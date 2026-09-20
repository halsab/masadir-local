import type { BookSearchResult } from '../shared/contracts';
import { button, element } from './dom';
import type { RendererState } from './state';
import { searchBlockReason } from './state';

export interface SearchActions {
  addBooks(): void;
  chooseRoot(): void;
  openLibrary(): void;
  openMatches(book: BookSearchResult): void;
  search(query: string, page: number): void;
}

const searchForm = (
  state: RendererState,
  actions: SearchActions,
): HTMLFormElement => {
  const form = element('form', 'search-form');
  form.setAttribute('role', 'search');
  const input = element('input', 'search-input');
  input.type = 'search';
  input.name = 'query';
  input.placeholder = 'Поиск по библиотеке';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Поисковый запрос');
  input.value = state.query;
  const reason = searchBlockReason(state);
  input.disabled = reason !== null;
  const submit = element('button', 'primary-button', 'Найти');
  submit.type = 'submit';
  submit.disabled = reason !== null;
  form.append(input, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (query.length > 0) actions.search(query, 1);
  });
  return form;
};

export const renderHome = (
  state: RendererState,
  actions: SearchActions,
): HTMLElement => {
  const view = element('section', 'home-view');
  const header = element('header', 'home-header');
  header.append(
    element('div', 'wordmark', 'Masādir'),
    button('Библиотека', 'text-button', actions.openLibrary),
  );
  const hero = element('div', 'search-hero');
  hero.append(
    element('p', 'eyebrow', 'Локальная библиотека'),
    element('h1', undefined, 'Найдите нужное в своих книгах'),
    searchForm(state, actions),
  );
  const snapshot = state.snapshot;
  if (snapshot?.library.status === 'empty') {
    const empty = element('div', 'home-empty');
    empty.append(
      element('p', undefined, 'Добавьте книги, чтобы начать поиск.'),
    );
    const emptyActions = element('div', 'action-row');
    emptyActions.append(
      button('Добавить книги', 'secondary-button', actions.addBooks),
      button('Выбрать папку библиотеки', 'text-button', actions.chooseRoot),
    );
    empty.append(emptyActions);
    hero.append(empty);
  } else if ((snapshot?.recentQueries.length ?? 0) > 0) {
    const recent = element('div', 'recent-searches');
    recent.append(element('h2', undefined, 'Недавние запросы'));
    const list = element('div', 'recent-list');
    for (const query of snapshot?.recentQueries.slice(0, 3) ?? []) {
      list.append(
        button(query, 'recent-query', () => actions.search(query, 1)),
      );
    }
    recent.append(list);
    hero.append(recent);
  }
  const reason = searchBlockReason(state);
  if (reason !== null) {
    const notice = element('p', 'notice', reason);
    notice.setAttribute('role', 'status');
    hero.append(notice);
  }
  view.append(header, hero);
  return view;
};

export const renderBooks = (
  state: RendererState,
  actions: SearchActions,
): HTMLElement => {
  const view = element('section', 'content-view');
  const header = element('header', 'content-header');
  header.append(
    button('← Новый поиск', 'text-button', () => actions.search('', 0)),
    button('Библиотека', 'text-button', actions.openLibrary),
  );
  const title = element('div', 'results-title');
  title.append(element('p', 'eyebrow', 'Результаты поиска'));
  const heading = element('h1');
  heading.dir = 'auto';
  heading.textContent = state.query;
  title.append(heading);
  view.append(header, title);

  if (!state.loading && state.books.length === 0) {
    view.append(
      element('p', 'empty-message', 'По этому запросу ничего не найдено.'),
    );
  } else {
    const list = element('div', 'book-results');
    for (const book of state.books) {
      const row = element('article', 'result-row');
      const copy = element('div', 'result-copy');
      const name = element('h2', undefined, book.title);
      name.dir = 'auto';
      copy.append(name);
      if (book.author !== undefined) {
        const author = element('p', 'book-author', book.author);
        author.dir = 'auto';
        copy.append(author);
      }
      copy.append(element('span', 'file-type', book.mimeType));
      row.append(copy, button('Совпадения', 'secondary-button', () => actions.openMatches(book)));
      list.append(row);
    }
    view.append(list);
  }

  if (state.booksPage > 1 || state.booksHasNext) {
    const pagination = element('nav', 'pagination');
    pagination.setAttribute('aria-label', 'Страницы результатов');
    if (state.booksPage > 1) {
      pagination.append(
        button('Назад', 'text-button', () => actions.search(state.query, state.booksPage - 1)),
      );
    }
    pagination.append(element('span', undefined, `Страница ${state.booksPage}`));
    if (state.booksHasNext) {
      pagination.append(
        button('Далее', 'text-button', () => actions.search(state.query, state.booksPage + 1)),
      );
    }
    view.append(pagination);
  }
  return view;
};
