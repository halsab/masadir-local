import path from 'node:path';

import type { IndexState } from '../../shared/contracts';
import type { RuntimeInfo } from '../recoll/recoll-adapter';
import type { IndexMetadataStore } from '../recoll/index-metadata-store';
import type { StoredBook, StoredLibraryState } from './library-types';

export interface IndexChangeSet {
  addedBookIds: string[];
  changedBookIds: string[];
  removedBooks: Array<{ bookId: string; relativePath: string }>;
  requiresRecovery: boolean;
}

export type IndexServiceState = IndexState;

interface RecollIndexAdapter {
  getRuntimeInfo(): RuntimeInfo;
  preflight(): Promise<RuntimeInfo>;
  setLibraryRoot(libraryRoot: string): void;
  indexFile(absolutePath: string): Promise<void>;
  removeFile(absolutePath: string): Promise<void>;
  updateFile(absolutePath: string): Promise<void>;
  recoverIncremental(): Promise<void>;
}

interface StateStorePort {
  save(state: StoredLibraryState): Promise<void>;
}

export class IndexService {
  private state: IndexServiceState = 'unknown';
  private libraryRoot: string;
  private tail: Promise<void> = Promise.resolve();
  private metadataNeedsRecovery = false;
  private compatibilityBlocked = false;

  constructor(
    private readonly adapter: RecollIndexAdapter,
    private readonly stateStore: StateStorePort,
    private readonly metadataStore: IndexMetadataStore,
    libraryRoot: string,
  ) {
    this.libraryRoot = libraryRoot;
  }

  getState(): IndexServiceState {
    return this.state;
  }

  getRuntimeInfo(): RuntimeInfo {
    return this.adapter.getRuntimeInfo();
  }

  async setLibraryRoot(libraryRoot: string): Promise<RuntimeInfo> {
    return this.enqueue(async () => {
      this.libraryRoot = libraryRoot;
      this.adapter.setLibraryRoot(libraryRoot);
      const runtime = await this.adapter.preflight();
      if (runtime.state !== 'ready') {
        this.state = 'failed';
        return runtime;
      }

      const metadata = await this.metadataStore.load();
      if (
        metadata.kind === 'valid' &&
        metadata.value.indexCompatibilityVersion !==
          runtime.indexCompatibilityVersion
      ) {
        // Несовместимый индекс не удаляется автоматически: rebuild запускается отдельно.
        this.compatibilityBlocked = true;
        this.state = 'failed';
        return runtime;
      }
      this.compatibilityBlocked = false;
      this.metadataNeedsRecovery = metadata.kind === 'corrupted';
      this.state = this.metadataNeedsRecovery ? 'needsRecovery' : 'ready';
      return runtime;
    });
  }

  indexImportedBook(
    book: StoredBook,
    libraryState: StoredLibraryState,
  ): Promise<void> {
    return this.enqueue(async () => {
      await this.indexBook(book, libraryState, false);
    });
  }

  updateBook(book: StoredBook, libraryState: StoredLibraryState): Promise<void> {
    return this.enqueue(async () => {
      await this.indexBook(book, libraryState, true);
    });
  }

  removeTrashedFile(absolutePath: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.compatibilityBlocked) {
        this.state = 'failed';
        return;
      }
      this.state = 'mutating';
      try {
        await this.adapter.removeFile(absolutePath);
        await this.saveCompatibilityMetadata();
        this.state = 'ready';
      } catch {
        this.state = 'needsRecovery';
      }
    });
  }

  applyLibraryChanges(
    changes: IndexChangeSet,
    libraryState: StoredLibraryState,
  ): Promise<void> {
    return this.enqueue(async () => {
      if (this.compatibilityBlocked) {
        this.markBooksFailed(
          [...changes.addedBookIds, ...changes.changedBookIds],
          libraryState,
        );
        await this.stateStore.save(libraryState);
        return;
      }
      if (changes.requiresRecovery || this.metadataNeedsRecovery) {
        await this.recover(libraryState);
        return;
      }
      if (this.state === 'failed') {
        this.markBooksFailed(
          [...changes.addedBookIds, ...changes.changedBookIds],
          libraryState,
        );
        await this.stateStore.save(libraryState);
        return;
      }

      for (const removed of changes.removedBooks) {
        this.state = 'mutating';
        try {
          await this.adapter.removeFile(this.absolutePath(removed.relativePath));
        } catch {
          this.state = 'needsRecovery';
          return;
        }
      }

      for (const bookId of changes.changedBookIds) {
        const book = libraryState.books.find((candidate) => candidate.bookId === bookId);
        if (book !== undefined) {
          await this.indexBook(book, libraryState, true);
        }
      }
      for (const bookId of changes.addedBookIds) {
        const book = libraryState.books.find((candidate) => candidate.bookId === bookId);
        if (book !== undefined) {
          await this.indexBook(book, libraryState, false);
        }
      }

      await this.saveCompatibilityMetadata();
      this.state = 'ready';
    });
  }

  recoverIncremental(libraryState: StoredLibraryState): Promise<void> {
    return this.enqueue(() => this.recover(libraryState));
  }

  private async indexBook(
    book: StoredBook,
    libraryState: StoredLibraryState,
    changed: boolean,
  ): Promise<void> {
    if (this.compatibilityBlocked) {
      book.indexStatus = 'failed';
      await this.stateStore.save(libraryState);
      this.state = 'failed';
      return;
    }
    this.state = 'mutating';
    book.indexStatus = 'indexing';
    await this.stateStore.save(libraryState);
    try {
      const absolutePath = this.absolutePath(book.relativePath);
      if (changed) {
        await this.adapter.updateFile(absolutePath);
      } else {
        await this.adapter.indexFile(absolutePath);
      }
      book.indexStatus = 'ready';
      await this.saveCompatibilityMetadata();
    } catch {
      book.indexStatus = 'failed';
    }
    await this.stateStore.save(libraryState);
    this.state =
      this.adapter.getRuntimeInfo().state === 'ready' ? 'ready' : 'failed';
  }

  private async recover(libraryState: StoredLibraryState): Promise<void> {
    if (this.compatibilityBlocked) {
      this.state = 'failed';
      return;
    }
    this.state = 'recovering';
    try {
      await this.adapter.recoverIncremental();
      for (const book of libraryState.books) {
        book.indexStatus = 'ready';
      }
      await this.stateStore.save(libraryState);
      await this.saveCompatibilityMetadata();
      this.metadataNeedsRecovery = false;
      this.state = 'ready';
    } catch {
      this.markBooksFailed(
        libraryState.books.map((book) => book.bookId),
        libraryState,
      );
      await this.stateStore.save(libraryState);
      this.state = 'failed';
    }
  }

  private markBooksFailed(
    bookIds: readonly string[],
    libraryState: StoredLibraryState,
  ): void {
    const ids = new Set(bookIds);
    for (const book of libraryState.books) {
      if (ids.has(book.bookId)) {
        book.indexStatus = 'failed';
      }
    }
  }

  private absolutePath(relativePath: string): string {
    return path.resolve(this.libraryRoot, relativePath);
  }

  private async saveCompatibilityMetadata(): Promise<void> {
    const runtime = this.adapter.getRuntimeInfo();
    if (
      runtime.state !== 'ready' ||
      runtime.recollVersion === undefined ||
      runtime.runtimeFingerprint === undefined ||
      runtime.indexCompatibilityVersion === undefined
    ) {
      return;
    }
    await this.metadataStore.save({
      schemaVersion: 1,
      recollVersion: runtime.recollVersion,
      runtimeFingerprint: runtime.runtimeFingerprint,
      indexCompatibilityVersion: runtime.indexCompatibilityVersion,
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.tail.then(operation, operation);
    this.tail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }
}
