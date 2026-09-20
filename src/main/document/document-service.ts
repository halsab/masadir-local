import { stat } from 'node:fs/promises';

import { AppError, ErrorCode } from '../../shared/contracts';
import { getSupportedMimeType } from '../library/library-files';
import { resolveLibraryPath } from '../library/path-safety';
import type { StoredBook } from '../library/library-types';

interface DocumentCatalog {
  libraryRoot: string;
  books: StoredBook[];
}

interface DocumentLibrary {
  getDocumentCatalog(): DocumentCatalog;
}

interface DocumentShell {
  openPath(filePath: string): Promise<string>;
}

export class DocumentService {
  constructor(
    private readonly library: DocumentLibrary,
    private readonly shell: DocumentShell,
  ) {}

  async open(bookId: string, pageNumber?: number): Promise<void> {
    const catalog = this.library.getDocumentCatalog();
    const book = catalog.books.find((candidate) => candidate.bookId === bookId);
    if (book === undefined) {
      throw new AppError(ErrorCode.bookNotFound, 'Книга не найдена.');
    }

    const filePath = await resolveLibraryPath(
      catalog.libraryRoot,
      book.relativePath,
    );
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      throw new AppError(ErrorCode.ioError, 'Файл книги недоступен.');
    }
    if (getSupportedMimeType(filePath) === null) {
      throw new AppError(
        ErrorCode.invalidArgument,
        'Поддерживаются только PDF, DOC и DOCX файлы.',
      );
    }

    // Портируемого способа передать страницу системному просмотрщику нет.
    void pageNumber;
    const shellError = await this.shell.openPath(filePath);
    if (shellError.length > 0) {
      throw new AppError(
        ErrorCode.documentOpenFailed,
        'Не удалось открыть документ.',
      );
    }
  }
}
