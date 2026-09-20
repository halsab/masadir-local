import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import { AppError, ErrorCode } from '../../shared/contracts';

const normalizedForComparison = (value: string): string => {
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const isInsideOrEqual = (parent: string, candidate: string): boolean => {
  const relative = path.relative(
    normalizedForComparison(parent),
    normalizedForComparison(candidate),
  );
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export const assertSafeRelativePath = (relativePath: string): string => {
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.includes('\0')
  ) {
    throw new AppError(ErrorCode.invalidArgument, 'Некорректный путь книги.');
  }

  const normalized = path.normalize(relativePath);
  if (
    normalized === '..' ||
    normalized.startsWith(`..${path.sep}`) ||
    path.isAbsolute(normalized)
  ) {
    throw new AppError(ErrorCode.invalidArgument, 'Выход за границы библиотеки запрещён.');
  }

  return normalized;
};

export const assertLibraryRootLocation = async (
  rootPath: string,
  forbiddenRoots: readonly string[],
): Promise<string> => {
  const canonicalRoot = await realpath(rootPath);

  for (const forbiddenRoot of forbiddenRoots) {
    let canonicalForbidden: string;
    try {
      canonicalForbidden = await realpath(forbiddenRoot);
    } catch {
      canonicalForbidden = path.resolve(forbiddenRoot);
    }

    if (isInsideOrEqual(canonicalForbidden, canonicalRoot)) {
      throw new AppError(
        ErrorCode.invalidArgument,
        'Библиотека должна находиться вне каталогов приложения.',
      );
    }
  }

  return canonicalRoot;
};

export const resolveLibraryPath = async (
  canonicalRoot: string,
  relativePath: string,
): Promise<string> => {
  const safeRelativePath = assertSafeRelativePath(relativePath);
  const candidate = path.resolve(canonicalRoot, safeRelativePath);

  if (!isInsideOrEqual(canonicalRoot, candidate) || candidate === canonicalRoot) {
    throw new AppError(ErrorCode.invalidArgument, 'Выход за границы библиотеки запрещён.');
  }

  const metadata = await lstat(candidate);
  if (metadata.isSymbolicLink()) {
    throw new AppError(ErrorCode.invalidArgument, 'Символические ссылки не поддерживаются.');
  }

  const canonicalCandidate = await realpath(candidate);
  if (!isInsideOrEqual(canonicalRoot, canonicalCandidate)) {
    throw new AppError(ErrorCode.invalidArgument, 'Выход за границы библиотеки запрещён.');
  }

  return canonicalCandidate;
};

export const isPathInside = (parent: string, candidate: string): boolean =>
  isInsideOrEqual(parent, candidate);
