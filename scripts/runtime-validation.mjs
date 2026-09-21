import { createHash } from 'node:crypto';
import { readdir, readFile, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const targets = {
  'darwin-arm64': { platform: 'darwin', arch: 'arm64' },
  'win32-x64': { platform: 'win32', arch: 'x64' },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\\') &&
    !value.includes(':') &&
    !value.includes('\0') &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    value
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function version(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !/^(unknown|todo|tbd|placeholder)$/iu.test(value.trim())
  );
}

function expectedArchitecture(binary, target) {
  if (target === 'win32-x64') {
    if (binary.length < 0x40 || binary.toString('ascii', 0, 2) !== 'MZ')
      return false;
    const pe = binary.readUInt32LE(0x3c);
    return (
      pe + 6 <= binary.length &&
      binary.toString('ascii', pe, pe + 4) === 'PE\0\0' &&
      binary.readUInt16LE(pe + 4) === 0x8664
    );
  }
  if (binary.length < 8) return false;
  if (binary.readUInt32LE(0) === 0xfeedfacf) {
    return binary.readUInt32LE(4) === 0x0100000c;
  }
  const magic = binary.readUInt32BE(0);
  if (magic !== 0xcafebabe && magic !== 0xcafebabf) return false;
  const count = binary.readUInt32BE(4);
  const stride = magic === 0xcafebabf ? 32 : 20;
  for (
    let index = 0;
    index < count && 8 + index * stride + 4 <= binary.length;
    index++
  ) {
    if (binary.readUInt32BE(8 + index * stride) === 0x0100000c) return true;
  }
  return false;
}

async function regularFile(root, relativePath) {
  assert(safePath(relativePath), `Unsafe runtime path: ${relativePath}`);
  const fullPath = path.join(root, relativePath);
  const metadata = await stat(fullPath);
  assert(metadata.isFile(), `Not a file: ${relativePath}`);
  assert(
    (await realpath(fullPath)).startsWith(`${await realpath(root)}${path.sep}`),
    `Runtime path escapes its root: ${relativePath}`,
  );
  return fullPath;
}

async function allFiles(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) result.push(relative);
    else if (entry.isDirectory())
      result.push(...(await allFiles(root, relative)));
    else {
      assert(entry.isFile(), `Unsupported runtime entry: ${relative}`);
      result.push(relative);
    }
  }
  return result;
}

export async function verifyRuntime(
  root,
  target,
  { allowTemplate = false } = {},
) {
  assert(targets[target], `Unsupported target: ${target}`);
  const manifest = JSON.parse(
    await readFile(path.join(root, 'runtime-manifest.json'), 'utf8'),
  );
  assert(manifest.schemaVersion === 1, 'Unsupported runtime manifest schema.');
  assert(
    manifest.platform === targets[target].platform &&
      manifest.arch === targets[target].arch,
    `Runtime manifest target does not match ${target}.`,
  );
  assert(
    version(manifest.recollVersion) &&
      version(manifest.indexCompatibilityVersion),
    'Recoll and index compatibility versions must be declared.',
  );
  assert(
    manifest.indexCompatibilityVersion === 'recoll-index-1.20-1.44',
    'Unexpected Recoll index compatibility range.',
  );
  assert(
    manifest.sourceArtifact &&
      /^https:\/\/[^\s]+$/u.test(manifest.sourceArtifact.url) &&
      version(manifest.sourceArtifact.filename) &&
      /^[0-9a-f]{64}$/u.test(manifest.sourceArtifact.sha256),
    'Source artifact URL, filename and SHA-256 are required.',
  );
  assert(
    Array.isArray(manifest.additionalArtifacts ?? []) &&
      (manifest.additionalArtifacts ?? []).every(
        (artifact) =>
          artifact &&
          /^https:\/\/[^\s]+$/u.test(artifact.url) &&
          version(artifact.filename) &&
          /^[0-9a-f]{64}$/u.test(artifact.sha256),
      ),
    'Additional source artifacts need URL, filename and SHA-256.',
  );
  assert(
    safePath(manifest.recollindexExecutable) &&
      safePath(manifest.recollqExecutable),
    'Invalid Recoll executable paths.',
  );
  assert(
    Array.isArray(manifest.helperDirectories) &&
      manifest.helperDirectories.length > 0 &&
      manifest.helperDirectories.every(safePath),
    'Invalid helper directories.',
  );
  assert(
    Array.isArray(manifest.requiredFiles) &&
      manifest.requiredFiles.length > 0 &&
      manifest.requiredFiles.every(safePath) &&
      new Set(manifest.requiredFiles).size === manifest.requiredFiles.length,
    'Invalid required runtime files.',
  );
  assert(
    manifest.requiredFiles.includes(manifest.recollindexExecutable) &&
      manifest.requiredFiles.includes(manifest.recollqExecutable),
    'Recoll executables must be required files.',
  );
  assert(
    manifest.helperVersions &&
      typeof manifest.helperVersions === 'object' &&
      !Array.isArray(manifest.helperVersions) &&
      Object.entries(manifest.helperVersions).every(
        ([name, value]) => safePath(name) && version(value),
      ),
    'Helper versions must be declared.',
  );
  assert(
    manifest.checksums &&
      typeof manifest.checksums === 'object' &&
      !Array.isArray(manifest.checksums) &&
      Object.keys(manifest.checksums).length === manifest.requiredFiles.length,
    'Provide SHA-256 for every required file.',
  );
  assert(
    manifest.symlinks &&
      typeof manifest.symlinks === 'object' &&
      !Array.isArray(manifest.symlinks) &&
      Object.entries(manifest.symlinks).every(
        ([link, destination]) => safePath(link) && safePath(destination),
      ),
    'Runtime symlinks must be declared with relative destinations.',
  );
  assert(
    Array.isArray(manifest.licenses) && manifest.licenses.length > 0,
    'Bundled license texts and provenance are required.',
  );

  const licensedComponents = new Set();
  for (const license of manifest.licenses) {
    assert(
      license &&
        version(license.name) &&
        version(license.version) &&
        /^https:\/\/[^\s]+$/u.test(license.source) &&
        safePath(license.path) &&
        manifest.requiredFiles.includes(license.path),
      'Invalid runtime license entry.',
    );
    await regularFile(root, license.path);
    assert(
      (await readFile(path.join(root, license.path))).length > 0,
      `Empty license text: ${license.path}`,
    );
    licensedComponents.add(license.name);
    if (license.name === 'Recoll') {
      assert(
        license.version === manifest.recollVersion,
        'Recoll license version differs.',
      );
    } else {
      assert(
        manifest.helperVersions[license.name] === license.version,
        `Helper license version differs: ${license.name}`,
      );
    }
  }
  assert(
    licensedComponents.has('Recoll') &&
      Object.keys(manifest.helperVersions).every((name) =>
        licensedComponents.has(name),
      ),
    'Every bundled component needs a license entry.',
  );

  for (const directory of manifest.helperDirectories) {
    assert(
      (await stat(path.join(root, directory))).isDirectory(),
      `Missing helper directory: ${directory}`,
    );
  }
  for (const relative of manifest.requiredFiles) {
    const file = await regularFile(root, relative);
    const expected = manifest.checksums[relative];
    assert(
      typeof expected === 'string' && /^[0-9a-f]{64}$/u.test(expected),
      `Missing SHA-256: ${relative}`,
    );
    const contents = await readFile(file);
    const actual = createHash('sha256').update(contents).digest('hex');
    assert(actual === expected, `SHA-256 mismatch: ${relative}`);
    if (
      relative === manifest.recollindexExecutable ||
      relative === manifest.recollqExecutable
    ) {
      assert(
        expectedArchitecture(contents, target),
        `Wrong executable architecture: ${relative}`,
      );
    }
  }
  for (const [relative, destination] of Object.entries(manifest.symlinks)) {
    const linkPath = path.join(root, relative);
    assert(
      (await readlink(linkPath)) === destination,
      `Runtime symlink differs: ${relative}`,
    );
    assert(
      (await realpath(linkPath)).startsWith(
        `${await realpath(root)}${path.sep}`,
      ),
      `Runtime symlink escapes its root: ${relative}`,
    );
  }
  if (target === 'darwin-arm64') {
    for (const executable of [
      manifest.recollindexExecutable,
      manifest.recollqExecutable,
    ]) {
      assert(
        ((await stat(path.join(root, executable))).mode & 0o111) !== 0,
        `Runtime executable lacks execute permission: ${executable}`,
      );
    }
  }
  const allowed = new Set([
    'runtime-manifest.json',
    ...manifest.requiredFiles,
    ...Object.keys(manifest.symlinks),
  ]);
  if (allowTemplate) allowed.add('runtime-manifest.template.json');
  for (const file of await allFiles(root)) {
    assert(allowed.has(file), `Undeclared runtime file: ${file}`);
  }
  return manifest;
}
