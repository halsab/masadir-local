import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  readFile,
  readdir,
  readlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { targets, verifyRuntime } from './runtime-validation.mjs';

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function entries(root, relative = '') {
  const files = [];
  const symlinks = {};
  for (const name of await readdir(path.join(root, relative))) {
    const item = path.posix.join(relative, name);
    const fullPath = path.join(root, item);
    const metadata = await lstat(fullPath);
    if (metadata.isSymbolicLink()) {
      symlinks[item] = await readlink(fullPath);
    } else if (metadata.isDirectory()) {
      const nested = await entries(root, item);
      files.push(...nested.files);
      Object.assign(symlinks, nested.symlinks);
    } else if (metadata.isFile()) {
      files.push(item);
    } else {
      throw new Error(`Unsupported runtime entry: ${item}`);
    }
  }
  return { files, symlinks };
}

export async function finalizeRuntime(target, artifacts) {
  if (!targets[target])
    throw new Error(`Unsupported runtime target: ${target}`);
  const root = path.join(repository, 'assets', 'runtime', target);
  const template = JSON.parse(
    await readFile(path.join(root, 'runtime-manifest.template.json'), 'utf8'),
  );
  for (const [artifact, filename, expected] of artifacts) {
    if ((await sha256(artifact)) !== expected) {
      throw new Error(`Source artifact SHA-256 mismatch: ${filename}`);
    }
  }

  const inventory = await entries(root);
  const requiredFiles = inventory.files.filter(
    (file) =>
      file !== 'runtime-manifest.json' &&
      file !== 'runtime-manifest.template.json',
  );
  const checksums = {};
  for (const file of requiredFiles) {
    checksums[file] = await sha256(path.join(root, file));
  }
  const manifest = {
    ...template,
    requiredFiles,
    checksums,
    symlinks: inventory.symlinks,
  };
  await writeFile(
    path.join(root, 'runtime-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await verifyRuntime(root, target, { allowTemplate: true });
  return manifest;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const target = process.argv[2];
  if (!targets[target]) throw new Error('Pass darwin-arm64 or win32-x64.');
  const template = JSON.parse(
    await readFile(
      path.join(
        repository,
        'assets',
        'runtime',
        target,
        'runtime-manifest.template.json',
      ),
      'utf8',
    ),
  );
  const artifactPaths = process.argv.slice(3);
  const sources = [
    template.sourceArtifact,
    ...(template.additionalArtifacts ?? []),
  ];
  if (artifactPaths.length !== sources.length) {
    throw new Error(`Pass ${sources.length} source artifact path(s).`);
  }
  const manifest = await finalizeRuntime(
    target,
    artifactPaths.map((artifact, index) => [
      artifact,
      sources[index].filename,
      sources[index].sha256,
    ]),
  );
  console.log(`Finalized ${target}: ${manifest.requiredFiles.length} files.`);
}
