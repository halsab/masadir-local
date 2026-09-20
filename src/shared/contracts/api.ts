import type { IpcResult } from './ipc-result';

export type BookStatus = 'pending' | 'indexing' | 'ready' | 'failed';

export interface BookSummary {
  id: string;
  fileName: string;
  status: BookStatus;
}

export interface AppSnapshot {
  appVersion: string;
  libraryRoot: string | null;
  books: BookSummary[];
}

export interface AddBooksResult {
  addedBookIds: string[];
}

export interface ChooseRootResult {
  rootPath: string | null;
}

export interface SearchBookResult {
  bookId: string;
  title: string;
}

export interface SearchBooksPage {
  page: number;
  hasMore: boolean;
  items: SearchBookResult[];
}

export interface SearchMatch {
  pageNumber: number | null;
  snippet: string;
}

export interface BookStatusChangedEvent {
  bookId: string;
  status: BookStatus;
}

export interface MasadirApi {
  app: {
    getSnapshot(): Promise<IpcResult<AppSnapshot>>;
  };
  library: {
    addBooks(): Promise<IpcResult<AddBooksResult>>;
    chooseRoot(): Promise<IpcResult<ChooseRootResult>>;
    listBooks(): Promise<IpcResult<BookSummary[]>>;
    trashBook(bookId: string): Promise<IpcResult<void>>;
    retryIndex(bookId: string): Promise<IpcResult<void>>;
    openFolder(): Promise<IpcResult<void>>;
  };
  search: {
    searchBooks(
      query: string,
      page: number,
    ): Promise<IpcResult<SearchBooksPage>>;
    searchMatches(
      bookId: string,
      limit: number,
    ): Promise<IpcResult<SearchMatch[]>>;
    cancel(): Promise<IpcResult<void>>;
  };
  document: {
    open(bookId: string, pageNumber?: number): Promise<IpcResult<void>>;
  };
  clipboard: {
    writeText(text: string): Promise<IpcResult<void>>;
  };
  events: {
    onBookStatusChanged(
      callback: (event: BookStatusChangedEvent) => void,
    ): () => void;
  };
}
