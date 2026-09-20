import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { reconcileLibrary } from '../../src/main/library/library-reconcile';
import { LibraryStateStore } from '../../src/main/library/library-state-store';
import type { StoredLibraryState } from '../../src/main/library/library-types';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'masadir-reconcile-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('reconcileLibrary', () => {
  it('reconciles add, delete, change and unchanged files idempotently', async () => {
    const root = await createTemporaryDirectory();
    const canonicalRoot = await realpath(root);
    await mkdir(path.join(root, 'sub'));
    const unchangedPath = path.join(root, 'unchanged.pdf');
    const changedPath = path.join(root, 'sub', 'changed.DOC');
    await Promise.all([
      writeFile(unchangedPath, 'unchanged'),
      writeFile(changedPath, 'changed'),
      writeFile(path.join(root, 'new.docx'), 'new'),
      writeFile(path.join(root, 'ignored.txt'), 'ignored'),
      writeFile(path.join(root, 'empty.pdf'), ''),
    ]);
    const [unchangedMetadata, changedMetadata] = await Promise.all([
      stat(unchangedPath),
      stat(changedPath),
    ]);

    let stored: StoredLibraryState = {
      schemaVersion: 1,
      books: [
        {
          bookId: 'unchanged-id',
          relativePath: 'unchanged.pdf',
          size: unchangedMetadata.size,
          mtimeMs: unchangedMetadata.mtimeMs,
          mimeType: 'application/pdf',
          indexStatus: 'ready',
        },
        {
          bookId: 'changed-id',
          relativePath: path.join('sub', 'changed.DOC'),
          size: changedMetadata.size + 1,
          mtimeMs: changedMetadata.mtimeMs,
          mimeType: 'application/msword',
          indexStatus: 'ready',
        },
        {
          bookId: 'missing-id',
          relativePath: 'missing.pdf',
          size: 5,
          mtimeMs: 10,
          mimeType: 'application/pdf',
          indexStatus: 'ready',
        },
      ],
    };
    let saveCount = 0;
    const store = {
      load: async () => ({ kind: 'valid' as const, state: stored }),
      save: async (state: StoredLibraryState) => {
        saveCount += 1;
        stored = state;
      },
    };

    const first = await reconcileLibrary(canonicalRoot, store, () => 'new-id');

    expect(first.changes).toEqual({
      addedBookIds: ['new-id'],
      changedBookIds: ['changed-id'],
      removedBookIds: ['missing-id'],
      requiresRecovery: false,
    });
    expect(first.state.books).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bookId: 'unchanged-id',
          indexStatus: 'ready',
        }),
        expect.objectContaining({
          bookId: 'changed-id',
          indexStatus: 'pending',
        }),
        expect.objectContaining({ bookId: 'new-id', indexStatus: 'pending' }),
      ]),
    );
    expect(first.state.books).toHaveLength(3);

    const second = await reconcileLibrary(
      canonicalRoot,
      store,
      () => 'unexpected-id',
    );
    expect(second.changes).toEqual({
      addedBookIds: [],
      changedBookIds: [],
      removedBookIds: [],
      requiresRecovery: false,
    });
    expect(second.state).toEqual(first.state);
    expect(saveCount).toBe(1);
  });

  it('rebuilds corrupted state and marks index recovery as required', async () => {
    const root = await createTemporaryDirectory();
    const canonicalRoot = await realpath(root);
    const stateFile = path.join(root, 'state.json');
    await Promise.all([
      writeFile(path.join(root, 'book.pdf'), 'book'),
      writeFile(stateFile, '{corrupted', 'utf8'),
    ]);
    const store = new LibraryStateStore(stateFile);

    const result = await reconcileLibrary(
      canonicalRoot,
      store,
      () => 'recovered-id',
    );

    expect(result.changes.requiresRecovery).toBe(true);
    expect(result.state.books).toEqual([
      expect.objectContaining({
        bookId: 'recovered-id',
        relativePath: 'book.pdf',
        indexStatus: 'pending',
      }),
    ]);
    expect(JSON.parse(await readFile(stateFile, 'utf8'))).toEqual(result.state);
  });

  it('treats an external rename as delete plus add and ignores symlinks', async () => {
    const parent = await createTemporaryDirectory();
    const root = path.join(parent, 'library');
    const outside = path.join(parent, 'outside.pdf');
    await mkdir(root);
    const canonicalRoot = await realpath(root);
    await writeFile(outside, 'outside');
    await symlink(outside, path.join(root, 'escaped.pdf'));
    const renamedPath = path.join(root, 'renamed.pdf');
    await writeFile(renamedPath, 'renamed');
    await appendFile(renamedPath, '-content');

    let stored: StoredLibraryState = {
      schemaVersion: 1,
      books: [
        {
          bookId: 'old-id',
          relativePath: 'old.pdf',
          size: 1,
          mtimeMs: 1,
          mimeType: 'application/pdf',
          indexStatus: 'ready',
        },
      ],
    };
    const store = {
      load: async () => ({ kind: 'valid' as const, state: stored }),
      save: async (state: StoredLibraryState) => {
        stored = state;
      },
    };

    const result = await reconcileLibrary(
      canonicalRoot,
      store,
      () => 'renamed-id',
    );

    expect(result.changes.addedBookIds).toEqual(['renamed-id']);
    expect(result.changes.removedBookIds).toEqual(['old-id']);
    expect(result.state.books.map((book) => book.relativePath)).toEqual([
      'renamed.pdf',
    ]);
  });
});
