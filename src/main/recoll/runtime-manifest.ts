import { createHash } from 'node:crypto';
import path from 'node:path';

export const RUNTIME_MANIFEST_SCHEMA_VERSION = 1 as const;

export interface RuntimeManifest {
  schemaVersion: typeof RUNTIME_MANIFEST_SCHEMA_VERSION;
  recollVersion: string;
  recollindexExecutable: string;
  recollqExecutable: string;
  helperDirectories: string[];
  requiredFiles: string[];
  indexCompatibilityVersion: string;
}

const isSafeRelativePath = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    return false;
  }

  const normalized = path.normalize(value);
  return (
    !path.isAbsolute(value) &&
    normalized !== '..' &&
    !normalized.startsWith(`..${path.sep}`)
  );
};

const isUniqueStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every(isSafeRelativePath) &&
  new Set(value).size === value.length;

export const parseRuntimeManifest = (value: unknown): RuntimeManifest => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Runtime manifest must be an object.');
  }

  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== RUNTIME_MANIFEST_SCHEMA_VERSION ||
    typeof manifest.recollVersion !== 'string' ||
    manifest.recollVersion.trim().length === 0 ||
    !isSafeRelativePath(manifest.recollindexExecutable) ||
    !isSafeRelativePath(manifest.recollqExecutable) ||
    !isUniqueStringArray(manifest.helperDirectories) ||
    manifest.helperDirectories.length === 0 ||
    !isUniqueStringArray(manifest.requiredFiles) ||
    typeof manifest.indexCompatibilityVersion !== 'string' ||
    manifest.indexCompatibilityVersion.trim().length === 0
  ) {
    throw new Error('Runtime manifest is invalid.');
  }

  const requiredFiles = manifest.requiredFiles as string[];
  if (
    !requiredFiles.includes(manifest.recollindexExecutable) ||
    !requiredFiles.includes(manifest.recollqExecutable)
  ) {
    throw new Error('Runtime executables must be listed as required files.');
  }

  return {
    schemaVersion: RUNTIME_MANIFEST_SCHEMA_VERSION,
    recollVersion: manifest.recollVersion,
    recollindexExecutable: manifest.recollindexExecutable,
    recollqExecutable: manifest.recollqExecutable,
    helperDirectories: [...(manifest.helperDirectories as string[])],
    requiredFiles: [...requiredFiles],
    indexCompatibilityVersion: manifest.indexCompatibilityVersion,
  };
};

export const createRuntimeFingerprint = (manifest: RuntimeManifest): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: manifest.schemaVersion,
        recollVersion: manifest.recollVersion,
        recollindexExecutable: manifest.recollindexExecutable,
        recollqExecutable: manifest.recollqExecutable,
        helperDirectories: manifest.helperDirectories,
        requiredFiles: manifest.requiredFiles,
        indexCompatibilityVersion: manifest.indexCompatibilityVersion,
      }),
    )
    .digest('hex');
