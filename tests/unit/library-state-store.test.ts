import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryStateStore } from '../../src/main/library/library-state-store';
import type { StoredLibraryState } from '../../src/main/library/library-types';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const createStore = async (): Promise<{
  directory: string;
  file: string;
  store: LibraryStateStore;
}> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'masadir-state-'));
  temporaryDirectories.push(directory);
  const file = path.join(directory, 'state.json');
  return { directory, file, store: new LibraryStateStore(file) };
};

describe('LibraryStateStore', () => {
  it('atomically replaces state without leaving temporary files', async () => {
    const { directory, file, store } = await createStore();
    const state: StoredLibraryState = {
      schemaVersion: 1,
      books: [
        {
          bookId: 'book-1',
          relativePath: 'dir/كتاب.pdf',
          size: 12,
          mtimeMs: 42,
          mimeType: 'application/pdf',
          indexStatus: 'pending',
        },
      ],
    };

    await store.save(state);

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(state);
    expect(await readdir(directory)).toEqual(['state.json']);
  });

  it('treats missing and malformed state as recoverable', async () => {
    const { file, store } = await createStore();
    await expect(store.load()).resolves.toEqual({ kind: 'missing' });

    await writeFile(file, '{broken', 'utf8');
    await expect(store.load()).resolves.toEqual({ kind: 'corrupted' });
  });
});
