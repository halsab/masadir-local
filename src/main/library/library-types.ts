import type { BookStatus } from '../../shared/contracts';

export const LIBRARY_STATE_SCHEMA_VERSION = 1 as const;

export interface StoredBook {
  bookId: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  mimeType: string;
  indexStatus: BookStatus;
}

export interface StoredLibraryState {
  schemaVersion: typeof LIBRARY_STATE_SCHEMA_VERSION;
  books: StoredBook[];
}

export const emptyStoredLibraryState = (): StoredLibraryState => ({
  schemaVersion: LIBRARY_STATE_SCHEMA_VERSION,
  books: [],
});
