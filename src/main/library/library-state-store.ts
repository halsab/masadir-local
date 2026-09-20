import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AppError, ErrorCode } from '../../shared/contracts';
import { assertSafeRelativePath } from './path-safety';
import {
  LIBRARY_STATE_SCHEMA_VERSION,
  type StoredBook,
  type StoredLibraryState,
} from './library-types';

export type LibraryStateLoadResult =
  | { kind: 'valid'; state: StoredLibraryState }
  | { kind: 'missing' | 'corrupted' };

const INDEX_STATUSES = new Set(['pending', 'indexing', 'ready', 'failed']);

const isStoredBook = (value: unknown): value is StoredBook => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const book = value as Record<string, unknown>;
  try {
    assertSafeRelativePath(String(book.relativePath ?? ''));
  } catch {
    return false;
  }

  return (
    typeof book.bookId === 'string' &&
    book.bookId.length > 0 &&
    typeof book.relativePath === 'string' &&
    Number.isFinite(book.size) &&
    (book.size as number) > 0 &&
    Number.isFinite(book.mtimeMs) &&
    (book.mtimeMs as number) >= 0 &&
    typeof book.mimeType === 'string' &&
    INDEX_STATUSES.has(book.indexStatus as string)
  );
};

const parseState = (value: unknown): StoredLibraryState | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const state = value as Record<string, unknown>;
  if (
    state.schemaVersion !== LIBRARY_STATE_SCHEMA_VERSION ||
    !Array.isArray(state.books) ||
    !state.books.every(isStoredBook)
  ) {
    return null;
  }

  const paths = new Set<string>();
  const ids = new Set<string>();
  for (const book of state.books) {
    if (paths.has(book.relativePath) || ids.has(book.bookId)) {
      return null;
    }
    paths.add(book.relativePath);
    ids.add(book.bookId);
  }

  return state as unknown as StoredLibraryState;
};

export class LibraryStateStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<LibraryStateLoadResult> {
    let serialized: string;
    try {
      serialized = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { kind: 'missing' };
      }
      return { kind: 'corrupted' };
    }

    try {
      const state = parseState(JSON.parse(serialized) as unknown);
      return state === null ? { kind: 'corrupted' } : { kind: 'valid', state };
    } catch {
      return { kind: 'corrupted' };
    }
  }

  async save(state: StoredLibraryState): Promise<void> {
    const temporaryPath = path.join(
      path.dirname(this.filePath),
      `.state-${process.pid}-${Date.now()}-${crypto.randomUUID()}.tmp`,
    );
    const serialized = `${JSON.stringify(state, null, 2)}\n`;

    try {
      await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new AppError(ErrorCode.ioError, 'Не удалось сохранить состояние библиотеки.', {
        cause: error,
      });
    }
  }
}
