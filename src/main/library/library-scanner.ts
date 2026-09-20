import { constants, access, lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { AppError, ErrorCode } from '../../shared/contracts';
import { getSupportedMimeType } from './library-files';
import { assertSafeRelativePath, isPathInside } from './path-safety';

export interface ScannedBookFile {
  relativePath: string;
  size: number;
  mtimeMs: number;
  mimeType: string;
}

export const scanLibrary = async (
  canonicalRoot: string,
): Promise<Map<string, ScannedBookFile>> => {
  const actualRoot = await realpath(canonicalRoot);
  if (
    !isPathInside(canonicalRoot, actualRoot) ||
    !isPathInside(actualRoot, canonicalRoot)
  ) {
    throw new AppError(
      ErrorCode.libraryUnavailable,
      'Корневой каталог библиотеки был заменён.',
    );
  }

  const files = new Map<string, ScannedBookFile>();

  const visit = async (directory: string, isRoot = false): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isRoot) {
        throw new AppError(
          ErrorCode.libraryUnavailable,
          'Не удалось прочитать библиотеку.',
          { cause: error },
        );
      }
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        let canonicalDirectory: string;
        try {
          canonicalDirectory = await realpath(absolutePath);
        } catch {
          continue;
        }
        if (isPathInside(canonicalRoot, canonicalDirectory)) {
          await visit(canonicalDirectory);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const mimeType = getSupportedMimeType(entry.name);
      if (mimeType === null) {
        continue;
      }

      try {
        const [metadata, canonicalFile] = await Promise.all([
          lstat(absolutePath),
          realpath(absolutePath),
          access(absolutePath, constants.R_OK),
        ]);
        if (
          !metadata.isFile() ||
          metadata.isSymbolicLink() ||
          metadata.size <= 0 ||
          !isPathInside(canonicalRoot, canonicalFile)
        ) {
          continue;
        }

        const relativePath = assertSafeRelativePath(
          path.relative(canonicalRoot, canonicalFile),
        );
        files.set(relativePath, {
          relativePath,
          size: metadata.size,
          mtimeMs: metadata.mtimeMs,
          mimeType,
        });
      } catch {
        continue;
      }
    }
  };

  await visit(canonicalRoot, true);
  return files;
};
