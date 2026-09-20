import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { IndexService } from '../../src/main/library/index-service';
import type { StoredLibraryState } from '../../src/main/library/library-types';
import { IndexMetadataStore } from '../../src/main/recoll/index-metadata-store';
import type { RuntimeInfo } from '../../src/main/recoll/recoll-adapter';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const runtimeInfo: RuntimeInfo = {
  state: 'ready',
  target: 'darwin-arm64',
  recollVersion: '1.40.2',
  runtimeFingerprint: 'fingerprint',
  indexCompatibilityVersion: '1',
};

class FakeAdapter {
  calls: string[] = [];
  info: RuntimeInfo = runtimeInfo;
  failIndex = false;
  failRemove = false;
  waitForIndex: Promise<void> | null = null;

  getRuntimeInfo(): RuntimeInfo {
    return this.info;
  }

  async preflight(): Promise<RuntimeInfo> {
    return this.info;
  }

  setLibraryRoot(_libraryRoot: string): void {
    void _libraryRoot;
  }

  async indexFile(filePath: string): Promise<void> {
    this.calls.push(`index:${filePath}`);
    if (this.failIndex) {
      throw new Error('index failed');
    }
    await this.waitForIndex;
  }

  async removeFile(filePath: string): Promise<void> {
    this.calls.push(`remove:${filePath}`);
    if (this.failRemove) {
      throw new Error('remove failed');
    }
  }

  async updateFile(filePath: string): Promise<void> {
    this.calls.push(`update:${filePath}`);
  }

  async recoverIncremental(): Promise<void> {
    this.calls.push('recover');
  }
}

const createHarness = async (adapter = new FakeAdapter()) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'masadir-index-service-'));
  directories.push(root);
  const indexDirectory = path.join(root, 'index');
  await mkdir(indexDirectory);
  const saves: StoredLibraryState[] = [];
  const service = new IndexService(
    adapter,
    {
      save: async (state) => {
        saves.push(structuredClone(state));
      },
    },
    new IndexMetadataStore(indexDirectory),
    root,
  );
  await service.setLibraryRoot(root);
  return { adapter, indexDirectory, root, saves, service };
};

const createState = (): StoredLibraryState => ({
  schemaVersion: 1,
  books: [
    {
      bookId: 'one',
      relativePath: 'one.pdf',
      size: 1,
      mtimeMs: 1,
      mimeType: 'application/pdf',
      indexStatus: 'pending',
    },
    {
      bookId: 'two',
      relativePath: 'two.pdf',
      size: 2,
      mtimeMs: 2,
      mimeType: 'application/pdf',
      indexStatus: 'pending',
    },
  ],
});

describe('IndexService', () => {
  it('serializes mutations and persists book status transitions', async () => {
    const adapter = new FakeAdapter();
    let releaseIndex = (): void => undefined;
    adapter.waitForIndex = new Promise<void>((resolve) => {
      releaseIndex = resolve;
    });
    const { root, saves, service } = await createHarness(adapter);
    const state = createState();

    const first = service.indexImportedBook(state.books[0], state);
    const second = service.indexImportedBook(state.books[1], state);
    await new Promise((resolve) => setImmediate(resolve));
    expect(adapter.calls).toEqual([`index:${path.join(root, 'one.pdf')}`]);
    expect(service.getState()).toBe('mutating');

    releaseIndex();
    await Promise.all([first, second]);

    expect(adapter.calls).toEqual([
      `index:${path.join(root, 'one.pdf')}`,
      `index:${path.join(root, 'two.pdf')}`,
    ]);
    expect(state.books.map((book) => book.indexStatus)).toEqual(['ready', 'ready']);
    expect(saves.some((saved) => saved.books[0].indexStatus === 'indexing')).toBe(true);
    expect(service.getState()).toBe('ready');
  });

  it('marks indexing failures on the book and erase failures for recovery', async () => {
    const adapter = new FakeAdapter();
    adapter.failIndex = true;
    const { root, service } = await createHarness(adapter);
    const state = createState();

    await service.indexImportedBook(state.books[0], state);
    expect(state.books[0].indexStatus).toBe('failed');

    adapter.failRemove = true;
    await service.removeTrashedFile(path.join(root, 'removed.pdf'));
    expect(service.getState()).toBe('needsRecovery');
  });

  it('runs startup diff sequentially and recovers corrupted state', async () => {
    const adapter = new FakeAdapter();
    const { indexDirectory, root, service } = await createHarness(adapter);
    const state = createState();

    await service.applyLibraryChanges(
      {
        addedBookIds: ['two'],
        changedBookIds: ['one'],
        removedBooks: [{ bookId: 'old', relativePath: 'old.pdf' }],
        requiresRecovery: false,
      },
      state,
    );
    expect(adapter.calls).toEqual([
      `remove:${path.join(root, 'old.pdf')}`,
      `update:${path.join(root, 'one.pdf')}`,
      `index:${path.join(root, 'two.pdf')}`,
    ]);

    await writeFile(path.join(indexDirectory, 'masadir-index.json'), '{broken');
    await service.setLibraryRoot(root);
    expect(service.getState()).toBe('needsRecovery');
    await service.applyLibraryChanges(
      {
        addedBookIds: [],
        changedBookIds: [],
        removedBooks: [],
        requiresRecovery: false,
      },
      state,
    );
    expect(adapter.calls.at(-1)).toBe('recover');
    expect(service.getState()).toBe('ready');
  });

  it('uses compatibility version, not Recoll version, for rebuild decisions', async () => {
    const adapter = new FakeAdapter();
    const { indexDirectory, root, service } = await createHarness(adapter);
    await new IndexMetadataStore(indexDirectory).save({
      schemaVersion: 1,
      recollVersion: '1.39.0',
      runtimeFingerprint: 'old-fingerprint',
      indexCompatibilityVersion: '1',
    });

    await service.setLibraryRoot(root);
    expect(service.getState()).toBe('ready');

    adapter.info = { ...runtimeInfo, indexCompatibilityVersion: '2' };
    await service.setLibraryRoot(root);
    expect(service.getState()).toBe('failed');
  });
});
