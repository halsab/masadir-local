import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createRecollConfig,
  writeRecollConfig,
} from '../../src/main/recoll/recoll-config';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Recoll config', () => {
  it('quotes paths deterministically and includes the isolated index settings', () => {
    const config = createRecollConfig({
      libraryRoot: '/library/كتب "quoted" $cash',
      indexDirectory: '/app/index',
      helperDirectories: ['/runtime/helpers one', '/runtime/helpers-two'],
      runtimeTempDirectory: '/app/runtime temp',
    });

    expect(config).toContain(
      'topdirs = "/library/كتب \\"quoted\\" $cash"',
    );
    expect(config).toContain('dbdir = /app/index');
    expect(config).toContain('followLinks = 0');
    expect(config).toContain('onlyNames = *.pdf *.PDF *.doc *.DOC *.docx *.DOCX');
    expect(config).toContain('indexallfilenames = 0');
    expect(config).toContain('skippedNames+=.masadir-import-*');
    expect(config).toContain('idxrundir = /app/runtime temp');
  });

  it('does not replace an unchanged config file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'masadir-config-'));
    directories.push(directory);
    await mkdir(directory, { recursive: true });
    const input = {
      libraryRoot: '/library',
      indexDirectory: '/index',
      helperDirectories: ['/helpers'],
      runtimeTempDirectory: '/temp',
    };

    expect(await writeRecollConfig(directory, input)).toMatchObject({
      changed: true,
    });
    const first = await stat(path.join(directory, 'recoll.conf'));
    expect(await writeRecollConfig(directory, input)).toMatchObject({
      changed: false,
    });
    const second = await stat(path.join(directory, 'recoll.conf'));

    expect(second.ino).toBe(first.ino);
    expect(await readFile(path.join(directory, 'recoll.conf'), 'utf8')).toBe(
      createRecollConfig(input),
    );
  });
});
