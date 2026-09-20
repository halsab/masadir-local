import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface IndexMetadata {
  schemaVersion: 1;
  recollVersion: string;
  runtimeFingerprint: string;
  indexCompatibilityVersion: string;
}

export type IndexMetadataLoadResult =
  | { kind: 'missing' | 'corrupted' }
  | { kind: 'valid'; value: IndexMetadata };

const parseMetadata = (value: unknown): IndexMetadata | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const metadata = value as Record<string, unknown>;
  if (
    metadata.schemaVersion !== 1 ||
    typeof metadata.recollVersion !== 'string' ||
    typeof metadata.runtimeFingerprint !== 'string' ||
    typeof metadata.indexCompatibilityVersion !== 'string'
  ) {
    return null;
  }
  return metadata as unknown as IndexMetadata;
};

export class IndexMetadataStore {
  private readonly filePath: string;

  constructor(indexDirectory: string) {
    this.filePath = path.join(indexDirectory, 'masadir-index.json');
  }

  async load(): Promise<IndexMetadataLoadResult> {
    try {
      const parsed = parseMetadata(
        JSON.parse(await readFile(this.filePath, 'utf8')) as unknown,
      );
      return parsed === null ? { kind: 'corrupted' } : { kind: 'valid', value: parsed };
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? { kind: 'missing' }
        : { kind: 'corrupted' };
    }
  }

  async save(metadata: IndexMetadata): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}
