import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SettingsService,
  defaultSettings,
} from '../../src/main/services/settings-service';

const temporaryDirectories: string[] = [];

const createSettingsFile = async (): Promise<{
  directory: string;
  file: string;
}> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'masadir-settings-'));
  temporaryDirectories.push(directory);
  return { directory, file: path.join(directory, 'settings.json') };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('SettingsService', () => {
  it('creates and returns defaults when settings are missing', async () => {
    const { file } = await createSettingsFile();
    const service = new SettingsService(file);

    await expect(service.load()).resolves.toEqual(defaultSettings());
    await expect(readFile(file, 'utf8')).resolves.toContain(
      '"schemaVersion": 1',
    );
  });

  it('migrates an unversioned settings file', async () => {
    const { file } = await createSettingsFile();
    await writeFile(file, JSON.stringify({ libraryRoot: '/books' }), 'utf8');

    const settings = await new SettingsService(file).load();

    expect(settings).toEqual({ schemaVersion: 1, libraryRoot: '/books' });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(settings);
  });

  it('atomically replaces settings without leaving a temporary file', async () => {
    const { directory, file } = await createSettingsFile();
    await writeFile(
      file,
      JSON.stringify({ schemaVersion: 1, libraryRoot: null }),
      'utf8',
    );

    await new SettingsService(file).save({
      schemaVersion: 1,
      libraryRoot: '/new-library',
    });

    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      schemaVersion: 1,
      libraryRoot: '/new-library',
    });
    expect(await readdir(directory)).toEqual(['settings.json']);
  });
});
