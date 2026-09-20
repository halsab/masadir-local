import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';

import { DocumentService } from '../../src/main/document/document-service';
import { AppError, ErrorCode } from '../../src/shared/contracts';
import type { StoredBook } from '../../src/main/library/library-types';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'masadir-document-'));
  temporaryDirectories.push(directory);
  return realpath(directory);
};

const createService = (
  libraryRoot: string,
  books: StoredBook[],
  openPath?: () => Promise<string>,
): { service: DocumentService; openPath: Mock<() => Promise<string>> } => {
  const shellOpenPath = vi.fn(openPath ?? (async () => ''));
  return {
    service: new DocumentService(
      { getDocumentCatalog: () => ({ libraryRoot, books }) },
      { openPath: shellOpenPath },
    ),
    openPath: shellOpenPath,
  };
};

const book = (relativePath: string): StoredBook => ({
  bookId: 'book-1',
  relativePath,
  size: 1,
  mtimeMs: 0,
  mimeType: 'application/pdf',
  indexStatus: 'ready',
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('DocumentService', () => {
  it('resolves a book only from the main-process library state', async () => {
    const root = await createTemporaryDirectory();
    await writeFile(path.join(root, 'book.pdf'), 'document');
    const { service, openPath } = createService(root, [book('book.pdf')]);

    await service.open('book-1');

    expect(openPath).toHaveBeenCalledWith(path.resolve(root, 'book.pdf'));
    await expect(service.open('unknown')).rejects.toMatchObject({
      code: ErrorCode.bookNotFound,
    });
  });

  it('rejects a path that escapes the library', async () => {
    const parent = await createTemporaryDirectory();
    const root = path.join(parent, 'library');
    const outside = path.join(parent, 'outside.pdf');
    await mkdir(root);
    await writeFile(outside, 'document');
    await symlink(outside, path.join(root, 'book.pdf'));
    const { service, openPath } = createService(root, [book('book.pdf')]);

    await expect(service.open('book-1')).rejects.toMatchObject({
      code: ErrorCode.invalidArgument,
    });
    expect(openPath).not.toHaveBeenCalled();
  });

  it('does not open a missing or unsupported file', async () => {
    const root = await createTemporaryDirectory();
    const missing = createService(root, [book('missing.pdf')]);
    await expect(missing.service.open('book-1')).rejects.toBeInstanceOf(Error);
    expect(missing.openPath).not.toHaveBeenCalled();

    await writeFile(path.join(root, 'book.txt'), 'document');
    const unsupported = createService(root, [book('book.txt')]);
    await expect(unsupported.service.open('book-1')).rejects.toMatchObject({
      code: ErrorCode.invalidArgument,
    });
    expect(unsupported.openPath).not.toHaveBeenCalled();
  });

  it('maps an Electron shell error without exposing it', async () => {
    const root = await createTemporaryDirectory();
    await writeFile(path.join(root, 'book.pdf'), 'document');
    const { service } = createService(root, [book('book.pdf')], async () =>
      'No application is registered',
    );

    await expect(service.open('book-1')).rejects.toMatchObject({
      code: ErrorCode.documentOpenFailed,
      message: 'Не удалось открыть документ.',
    });
  });

  it('opens from the start when a page target is supplied', async () => {
    const root = await createTemporaryDirectory();
    await writeFile(path.join(root, 'book.pdf'), 'document');
    const { service, openPath } = createService(root, [book('book.pdf')]);

    await service.open('book-1', 27);

    expect(openPath).toHaveBeenCalledTimes(1);
  });
});
