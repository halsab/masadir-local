import type { BookMatch } from '../shared/contracts';
import { button, element } from './dom';
import { appendHighlightedText } from './highlight';
import type { RendererState } from './state';

export interface MatchActions {
  back(): void;
  copy(match: BookMatch, target: HTMLButtonElement): void;
  loadMore(): void;
  open(match: BookMatch): void;
}

export const renderMatches = (
  state: RendererState,
  actions: MatchActions,
): HTMLElement => {
  const view = element('section', 'content-view');
  const header = element('header', 'content-header');
  header.append(
    button('← К книгам', 'text-button', actions.back),
    element('div', 'wordmark', 'Masādir'),
  );
  const title = element('div', 'match-heading');
  title.append(element('p', 'eyebrow', 'Совпадения в книге'));
  const bookTitle = element('h1', undefined, state.selectedBook?.title ?? 'Книга');
  bookTitle.dir = 'auto';
  const query = element('p', 'match-query');
  query.append(document.createTextNode('Запрос: '));
  const queryValue = element('span', undefined, state.query);
  queryValue.dir = 'auto';
  query.append(queryValue);
  title.append(bookTitle, query);
  view.append(header, title);

  if (!state.loading && state.matches.length === 0) {
    view.append(element('p', 'empty-message', 'В этой книге совпадений не найдено.'));
    return view;
  }

  const list = element('div', 'match-list');
  for (const match of state.matches) {
    const row = element('article', 'match-row');
    if (match.pageNumber !== undefined) {
      row.append(element('p', 'page-number', `Страница ${match.pageNumber}`));
    }
    const snippet = element('p', 'snippet');
    snippet.dir = 'auto';
    appendHighlightedText(snippet, match.snippet, match.matchRanges);
    const rowActions = element('div', 'row-actions');
    rowActions.append(button('Открыть', 'secondary-button', () => actions.open(match)));
    const copyButton = button('Копировать', 'text-button', () => actions.copy(match, copyButton));
    rowActions.append(copyButton);
    row.append(snippet, rowActions);
    list.append(row);
  }
  view.append(list);
  if (state.matches.length === state.matchesLimit && state.matchesLimit < 200) {
    view.append(button('Показать ещё', 'load-more', actions.loadMore));
  }
  return view;
};
