import { createHash } from 'node:crypto';
import path from 'node:path';

export const RUNTIME_MANIFEST_SCHEMA_VERSION = 1 as const;

export interface RuntimeManifest {
  schemaVersion: typeof RUNTIME_MANIFEST_SCHEMA_VERSION;
  platform?: 'darwin' | 'win32';
  arch?: 'arm64' | 'x64';
  recollVersion: string;
  recollindexExecutable: string;
  recollqExecutable: string;
  helperDirectories: string[];
  requiredFiles: string[];
  indexCompatibilityVersion: string;
  helperVersions?: Record<string, string>;
  checksums?: Record<string, string>;
  licenses?: Array<{ name: string; version: string; source: string; path: string }>;
}

type RuntimeLicense = NonNullable<RuntimeManifest['licenses']>[number];

const isSafeRelativePath = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    return false;
  }

  const segments = value.split(/[\\/]/u);
  const normalized = path.normalize(value);
  return (
    !path.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    !path.posix.isAbsolute(value) &&
    !segments.includes('..') &&
    normalized !== '..' &&
    !normalized.startsWith(`..${path.sep}`)
  );
};

const isUniqueStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every(isSafeRelativePath) &&
  new Set(value).size === value.length;

const isStringRecord = (
  value: unknown,
  validate: (entry: string) => boolean,
): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.entries(value).every(
    ([key, entry]) => isSafeRelativePath(key) && typeof entry === 'string' && validate(entry),
  );

const isRuntimeLicense = (entry: unknown): entry is RuntimeLicense => {
  if (typeof entry !== 'object' || entry === null) return false;
  const license = entry as Record<string, unknown>;
  return (
    typeof license.name === 'string' && license.name.trim().length > 0 &&
    typeof license.version === 'string' && license.version.trim().length > 0 &&
    typeof license.source === 'string' && license.source.trim().length > 0 &&
    isSafeRelativePath(license.path)
  );
};

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
    manifest.indexCompatibilityVersion.trim().length === 0 ||
    (manifest.platform !== undefined && !['darwin', 'win32'].includes(manifest.platform as string)) ||
    (manifest.arch !== undefined && !['arm64', 'x64'].includes(manifest.arch as string)) ||
    (manifest.helperVersions !== undefined &&
      !isStringRecord(manifest.helperVersions, (entry) => entry.trim().length > 0)) ||
    (manifest.checksums !== undefined &&
      !isStringRecord(manifest.checksums, (entry) => /^[a-f0-9]{64}$/u.test(entry))) ||
    (manifest.licenses !== undefined &&
      (!Array.isArray(manifest.licenses) ||
        !manifest.licenses.every(isRuntimeLicense)))
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
    ...(manifest.platform === undefined ? {} : { platform: manifest.platform as 'darwin' | 'win32' }),
    ...(manifest.arch === undefined ? {} : { arch: manifest.arch as 'arm64' | 'x64' }),
    recollVersion: manifest.recollVersion,
    recollindexExecutable: manifest.recollindexExecutable,
    recollqExecutable: manifest.recollqExecutable,
    helperDirectories: [...(manifest.helperDirectories as string[])],
    requiredFiles: [...requiredFiles],
    indexCompatibilityVersion: manifest.indexCompatibilityVersion,
    ...(manifest.helperVersions === undefined ? {} : { helperVersions: { ...(manifest.helperVersions as Record<string, string>) } }),
    ...(manifest.checksums === undefined ? {} : { checksums: { ...(manifest.checksums as Record<string, string>) } }),
    ...(manifest.licenses === undefined ? {} : { licenses: [...(manifest.licenses as RuntimeLicense[])] }),
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
        platform: manifest.platform,
        arch: manifest.arch,
        helperVersions: manifest.helperVersions,
        checksums: manifest.checksums,
        licenses: manifest.licenses,
      }),
    )
    .digest('hex');
