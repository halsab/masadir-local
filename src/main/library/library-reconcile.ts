import { randomUUID } from 'node:crypto';

import type { IndexChangeSet } from './index-service';
import { scanLibrary } from './library-scanner';
import type {
  LibraryStateLoadResult,
  LibraryStateStore,
} from './library-state-store';
import {
  LIBRARY_STATE_SCHEMA_VERSION,
  type StoredBook,
  type StoredLibraryState,
} from './library-types';

interface StateStorePort {
  load(): Promise<LibraryStateLoadResult>;
  save(state: StoredLibraryState): Promise<void>;
}

export interface ReconcileResult {
  state: StoredLibraryState;
  changes: IndexChangeSet;
}

export const reconcileLibrary = async (
  canonicalRoot: string,
  stateStore: StateStorePort | LibraryStateStore,
  createBookId: () => string = randomUUID,
): Promise<ReconcileResult> => {
  const [loaded, scanned] = await Promise.all([
    stateStore.load(),
    scanLibrary(canonicalRoot),
  ]);
  const previousBooks = loaded.kind === 'valid' ? loaded.state.books : [];
  const previousByPath = new Map(
    previousBooks.map((book) => [book.relativePath, book]),
  );
  const nextBooks: StoredBook[] = [];
  const addedBookIds: string[] = [];
  const changedBookIds: string[] = [];

  for (const relativePath of [...scanned.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const file = scanned.get(relativePath)!;
    const previous = previousByPath.get(relativePath);
    if (previous === undefined) {
      const bookId = createBookId();
      addedBookIds.push(bookId);
      nextBooks.push({ ...file, bookId, indexStatus: 'pending' });
      continue;
    }

    previousByPath.delete(relativePath);
    if (previous.size === file.size && previous.mtimeMs === file.mtimeMs) {
      nextBooks.push(previous);
      continue;
    }

    changedBookIds.push(previous.bookId);
    nextBooks.push({
      ...previous,
      ...file,
      indexStatus: 'pending',
    });
  }

  const removedBooks = [...previousByPath.values()].map((book) => ({
    bookId: book.bookId,
    relativePath: book.relativePath,
  }));
  const state: StoredLibraryState = {
    schemaVersion: LIBRARY_STATE_SCHEMA_VERSION,
    books: nextBooks,
  };
  const requiresSave =
    loaded.kind !== 'valid' ||
    addedBookIds.length > 0 ||
    changedBookIds.length > 0 ||
    removedBooks.length > 0;

  if (requiresSave) {
    await stateStore.save(state);
  }

  return {
    state:
      !requiresSave && loaded.kind === 'valid' ? loaded.state : state,
    changes: {
      addedBookIds,
      changedBookIds,
      removedBooks,
      requiresRecovery: loaded.kind === 'corrupted',
    },
  };
};
