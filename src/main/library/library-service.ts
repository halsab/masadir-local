import {
  constants,
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import {
  AppError,
  ErrorCode,
  type AddBooksResult,
  type ChooseRootResult,
  type LibraryBook,
  type LibraryState,
} from '../../shared/contracts';
import type { Settings, SettingsService } from '../services/settings-service';
import { findAvailableFileName, getSupportedMimeType } from './library-files';
import { reconcileLibrary } from './library-reconcile';
import type { LibraryStateStore } from './library-state-store';
import {
  emptyStoredLibraryState,
  type StoredBook,
  type StoredLibraryState,
} from './library-types';
import {
  assertLibraryRootLocation,
  resolveLibraryPath,
} from './path-safety';

interface LibraryDialogs {
  chooseDirectory(): Promise<string | null>;
  chooseBooks(): Promise<string[]>;
  confirmConflict(originalName: string, availableName: string): Promise<boolean>;
  confirmTrash(fileName: string): Promise<boolean>;
}

interface LibraryShell {
  trashItem(filePath: string): Promise<void>;
  showItemInFolder(filePath: string): void;
}

export interface LibraryServiceOptions {
  dialogs: LibraryDialogs;
  forbiddenRoots: readonly string[];
  settings: Settings;
  settingsService: SettingsService;
  shell: LibraryShell;
  stateStore: LibraryStateStore;
}

const toLibraryBook = (book: StoredBook): LibraryBook => {
  const parsed = path.parse(book.relativePath);
  return {
    bookId: book.bookId,
    fileName: parsed.base,
    ...(parsed.dir.length > 0 ? { relativeDirectory: parsed.dir } : {}),
    mimeType: book.mimeType,
    indexStatus: book.indexStatus,
  };
};

export class LibraryService {
  private state: StoredLibraryState = emptyStoredLibraryState();
  private status: LibraryState['status'] = 'unavailable';
  private canonicalRoot: string | null = null;

  constructor(private readonly options: LibraryServiceOptions) {}

  getState(): LibraryState {
    return { status: this.status, books: this.state.books.map(toLibraryBook) };
  }

  listBooks(): LibraryBook[] {
    return this.getState().books;
  }

  async chooseRoot(): Promise<ChooseRootResult> {
    const selectedPath = await this.options.dialogs.chooseDirectory();
    if (selectedPath === null) {
      return { selected: false, library: this.getState() };
    }

    await mkdir(selectedPath, { recursive: true });
    const canonicalRoot = await assertLibraryRootLocation(
      selectedPath,
      this.options.forbiddenRoots,
    );
    const settings: Settings = {
      ...this.options.settings,
      libraryRoot: canonicalRoot,
    };
    await this.options.settingsService.save(settings);
    this.options.settings.libraryRoot = canonicalRoot;
    await this.initializeRoot(canonicalRoot);

    return { selected: true, library: this.getState() };
  }

  async addBooks(): Promise<AddBooksResult> {
    const root = this.requireRoot();
    const sourcePaths = await this.options.dialogs.chooseBooks();
    const addedBookIds: string[] = [];
    const existingNames = new Set(await readdir(root));

    for (const sourcePath of sourcePaths) {
      const source = await this.validateImportSource(sourcePath);
      let finalName = path.basename(sourcePath);
      const availableName = findAvailableFileName(finalName, existingNames);
      if (availableName !== finalName) {
        const accepted = await this.options.dialogs.confirmConflict(
          finalName,
          availableName,
        );
        if (!accepted) {
          continue;
        }
        finalName = availableName;
      }

      const temporaryPath = path.join(
        root,
        `.masadir-import-${crypto.randomUUID()}.tmp`,
      );
      const finalPath = path.join(root, finalName);
      try {
        await copyFile(sourcePath, temporaryPath, constants.COPYFILE_EXCL);
        await rename(temporaryPath, finalPath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw new AppError(ErrorCode.ioError, 'Не удалось импортировать книгу.', {
          cause: error,
        });
      }

      const imported = await stat(finalPath);
      const book: StoredBook = {
        bookId: crypto.randomUUID(),
        relativePath: finalName,
        size: imported.size,
        mtimeMs: imported.mtimeMs,
        mimeType: source.mimeType,
        indexStatus: 'pending',
      };
      this.state.books.push(book);
      existingNames.add(finalName);
      addedBookIds.push(book.bookId);
      await this.options.stateStore.save(this.state);
    }

    this.status = this.state.books.length === 0 ? 'empty' : 'ready';
    return { addedBookIds };
  }

  async trashBook(bookId: string): Promise<void> {
    const root = this.requireRoot();
    const book = this.state.books.find((candidate) => candidate.bookId === bookId);
    if (book === undefined) {
      throw new AppError(ErrorCode.bookNotFound, 'Книга не найдена.');
    }

    const filePath = await resolveLibraryPath(root, book.relativePath);
    if (!(await this.options.dialogs.confirmTrash(path.basename(book.relativePath)))) {
      return;
    }

    await this.options.shell.trashItem(filePath);
    this.state.books = this.state.books.filter(
      (candidate) => candidate.bookId !== bookId,
    );
    await this.options.stateStore.save(this.state);
    this.status = this.state.books.length === 0 ? 'empty' : 'ready';
  }

  openFolder(): void {
    this.options.shell.showItemInFolder(this.requireRoot());
  }

  setLoadedState(canonicalRoot: string, state: StoredLibraryState): void {
    this.canonicalRoot = canonicalRoot;
    this.state = state;
    this.status = state.books.length === 0 ? 'empty' : 'ready';
  }

  setReconciling(canonicalRoot: string): void {
    this.canonicalRoot = canonicalRoot;
    this.status = 'reconciling';
  }

  async initializeRoot(canonicalRoot: string): Promise<void> {
    this.setReconciling(canonicalRoot);
    try {
      const result = await reconcileLibrary(
        canonicalRoot,
        this.options.stateStore,
      );
      this.setLoadedState(canonicalRoot, result.state);
    } catch (error) {
      this.status = 'unavailable';
      throw error;
    }
  }

  private requireRoot(): string {
    if (this.canonicalRoot === null) {
      throw new AppError(
        ErrorCode.libraryUnavailable,
        'Библиотека недоступна.',
      );
    }
    return this.canonicalRoot;
  }

  private async validateImportSource(
    sourcePath: string,
  ): Promise<{ mimeType: string }> {
    const metadata = await lstat(sourcePath);
    const mimeType = getSupportedMimeType(sourcePath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size <= 0 ||
      mimeType === null
    ) {
      throw new AppError(
        ErrorCode.invalidArgument,
        'Можно импортировать только непустые PDF, DOC и DOCX файлы.',
      );
    }
    await access(sourcePath, constants.R_OK);
    return { mimeType };
  }
}
