import { readFile, rename, unlink, writeFile } from 'node:fs/promises';

import { AppError, ErrorCode } from '../../shared/contracts';

const CURRENT_SCHEMA_VERSION = 2 as const;

export interface Settings {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  libraryRoot: string | null;
  recentQueries: string[];
}

export const defaultSettings = (): Settings => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  libraryRoot: null,
  recentQueries: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const migrateSettings = (value: unknown): Settings => {
  if (!isRecord(value)) {
    throw new AppError(
      ErrorCode.settingsInvalid,
      'Файл настроек имеет неверный формат.',
    );
  }

  const schemaVersion = value.schemaVersion ?? 0;
  const libraryRoot = value.libraryRoot;

  if (
    schemaVersion !== 0 &&
    schemaVersion !== 1 &&
    schemaVersion !== CURRENT_SCHEMA_VERSION
  ) {
    throw new AppError(
      ErrorCode.settingsInvalid,
      'Версия файла настроек не поддерживается.',
    );
  }

  if (
    libraryRoot !== null &&
    libraryRoot !== undefined &&
    typeof libraryRoot !== 'string'
  ) {
    throw new AppError(
      ErrorCode.settingsInvalid,
      'Путь к библиотеке в настройках имеет неверный формат.',
    );
  }

  const recentQueries = value.recentQueries ?? [];
  if (
    !Array.isArray(recentQueries) ||
    recentQueries.length > 3 ||
    recentQueries.some(
      (query) =>
        typeof query !== 'string' ||
        query.length === 0 ||
        Array.from(query).length > 256,
    ) ||
    new Set(recentQueries).size !== recentQueries.length
  ) {
    throw new AppError(
      ErrorCode.settingsInvalid,
      'История поиска в настройках имеет неверный формат.',
    );
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    libraryRoot: libraryRoot ?? null,
    recentQueries: [...recentQueries],
  };
};

export class SettingsService {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Settings> {
    let serialized: string;

    try {
      serialized = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const settings = defaultSettings();
        await this.save(settings);
        return settings;
      }

      throw new AppError(ErrorCode.ioError, 'Не удалось прочитать настройки.', {
        cause: error,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized) as unknown;
    } catch (error) {
      throw new AppError(
        ErrorCode.settingsInvalid,
        'Файл настроек содержит некорректный JSON.',
        { cause: error },
      );
    }

    const settings = migrateSettings(parsed);
    if (!isRecord(parsed) || parsed.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      await this.save(settings);
    }

    return settings;
  }

  async save(settings: Settings): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const serialized = `${JSON.stringify(settings, null, 2)}\n`;

    try {
      await writeFile(temporaryPath, serialized, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new AppError(ErrorCode.ioError, 'Не удалось сохранить настройки.', {
        cause: error,
      });
    }
  }
}
