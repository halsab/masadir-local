import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface RecollConfigInput {
  libraryRoot: string;
  indexDirectory: string;
  helperDirectories: readonly string[];
  runtimeTempDirectory: string;
}

const validateRecollValue = (value: string): string => {
  if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
    throw new Error('Recoll config paths must not contain control characters.');
  }
  return value;
};

export const createRecollConfig = (input: RecollConfigInput): string => {
  const helperPath = input.helperDirectories.join(path.delimiter);
  return [
    `topdirs = "${validateRecollValue(path.resolve(input.libraryRoot)).replace(/"/gu, '\\"')}"`,
    `dbdir = ${validateRecollValue(path.resolve(input.indexDirectory))}`,
    'followLinks = 0',
    'onlyNames = *.pdf *.PDF *.doc *.DOC *.docx *.DOCX',
    'indexallfilenames = 0',
    'skippedNames+=.masadir-import-*',
    `recollhelperpath = ${validateRecollValue(helperPath)}`,
    `idxrundir = ${validateRecollValue(path.resolve(input.runtimeTempDirectory))}`,
    '',
  ].join('\n');
};

export interface RecollConfigWriteResult {
  filePath: string;
  changed: boolean;
}

export const writeRecollConfig = async (
  configDirectory: string,
  input: RecollConfigInput,
): Promise<RecollConfigWriteResult> => {
  const filePath = path.join(configDirectory, 'recoll.conf');
  const serialized = createRecollConfig(input);
  const current = await readFile(filePath, 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    },
  );
  if (current === serialized) {
    return { filePath, changed: false };
  }

  const temporaryPath = path.join(
    configDirectory,
    `.recoll-${process.pid}-${Date.now()}-${crypto.randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  return { filePath, changed: true };
};
