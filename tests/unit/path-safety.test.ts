import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertSafeRelativePath,
  resolveLibraryPath,
} from '../../src/main/library/path-safety';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'masadir-paths-'));
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

describe('library path safety', () => {
  it('rejects traversal and absolute paths', () => {
    expect(() => assertSafeRelativePath('../outside.pdf')).toThrow();
    expect(() => assertSafeRelativePath(path.resolve('/outside.pdf'))).toThrow();
    expect(assertSafeRelativePath('كتب/Book One.PDF')).toBe(
      path.join('كتب', 'Book One.PDF'),
    );
  });

  it('rejects a symlink that could escape the library', async () => {
    const parent = await createTemporaryDirectory();
    const root = path.join(parent, 'library');
    const outside = path.join(parent, 'outside');
    await Promise.all([mkdir(root), mkdir(outside)]);
    await writeFile(path.join(outside, 'secret.pdf'), 'secret');
    await symlink(path.join(outside, 'secret.pdf'), path.join(root, 'book.pdf'));

    await expect(resolveLibraryPath(root, 'book.pdf')).rejects.toThrow(
      'Символические ссылки',
    );
  });
});
