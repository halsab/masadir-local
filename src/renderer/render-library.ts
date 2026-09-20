import type { LibraryBook } from '../shared/contracts';
import { button, element } from './dom';
import type { RendererState } from './state';

export interface LibraryActions {
  addBooks(): void;
  chooseRoot(): void;
  goHome(): void;
  openFolder(): void;
  retryIndex(bookId: string): void;
  trashBook(bookId: string): void;
}

const statusLabel = (book: LibraryBook): string => {
  switch (book.indexStatus) {
    case 'ready':
      return 'Готова';
    case 'indexing':
      return 'Индексируется';
    case 'pending':
      return 'Ожидает индексации';
    case 'failed':
      return 'Ошибка индексации';
  }
};

export const renderLibrary = (
  state: RendererState,
  actions: LibraryActions,
): HTMLElement => {
  const snapshot = state.snapshot;
  const books = snapshot?.library.books ?? [];
  const view = element('section', 'content-view');
  const header = element('header', 'content-header');
  header.append(
    button('← Поиск', 'text-button', actions.goHome),
    element('div', 'wordmark', 'Masādir'),
  );
  const heading = element('div', 'library-heading');
  const headingCopy = element('div');
  headingCopy.append(
    element('p', 'eyebrow', 'Локальная коллекция'),
    element('h1', undefined, 'Библиотека'),
    element('p', 'library-count', `${books.length} ${books.length === 1 ? 'книга' : 'книг'}`),
  );
  const actionsRow = element('div', 'action-row');
  actionsRow.append(
    button('Добавить книги', 'primary-button compact', actions.addBooks),
    button('Открыть папку', 'secondary-button', actions.openFolder),
  );
  heading.append(headingCopy, actionsRow);
  view.append(header, heading);

  const root = element('div', 'library-root');
  root.append(element('span', 'meta-label', 'Папка библиотеки'));
  const rootValue = element(
    'span',
    'root-value',
    snapshot?.libraryRoot ?? 'Папка не выбрана',
  );
  rootValue.dir = 'auto';
  root.append(rootValue, button('Выбрать другую', 'text-button', actions.chooseRoot));
  view.append(root);

  if (books.length === 0) {
    const empty = element('div', 'library-empty');
    empty.append(
      element('h2', undefined, 'В библиотеке пока нет книг'),
      element('p', undefined, 'Добавьте PDF, DOC или DOCX либо выберите существующую папку библиотеки.'),
    );
    const emptyActions = element('div', 'action-row');
    emptyActions.append(
      button('Добавить книги', 'primary-button compact', actions.addBooks),
      button('Выбрать папку библиотеки', 'secondary-button', actions.chooseRoot),
    );
    empty.append(emptyActions);
    view.append(empty);
    return view;
  }

  const list = element('div', 'library-list');
  for (const book of books) {
    const row = element('article', 'library-row');
    const copy = element('div', 'library-book');
    const name = element('h2', undefined, book.fileName);
    name.dir = 'auto';
    const details = element('div', 'book-details');
    details.append(
      element('span', 'file-type', book.mimeType),
      element(`span`, `status status-${book.indexStatus}`, statusLabel(book)),
    );
    copy.append(name, details);
    const rowActions = element('div', 'row-actions');
    if (book.indexStatus === 'failed') {
      rowActions.append(
        button('Повторить индексацию', 'text-button', () => actions.retryIndex(book.bookId)),
      );
    }
    rowActions.append(
      button('В Корзину', 'danger-button', () => actions.trashBook(book.bookId)),
    );
    row.append(copy, rowActions);
    list.append(row);
  }
  view.append(list);
  return view;
};
