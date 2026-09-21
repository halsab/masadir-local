import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { targets, verifyRuntime } from './runtime-validation.mjs';

const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
if (!targets[target]) throw new Error(`Unsupported runtime target: ${target}`);
if (target !== `${process.platform}-${process.arch}`) {
  throw new Error(
    'Verify runtime on the matching target operating system and architecture.',
  );
}
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const root = path.join(repository, 'assets', 'runtime', target);
const manifest = await verifyRuntime(root, target, {
  allowTemplate: true,
}).catch((error) => {
  if (error.code === 'ENOENT') {
    throw new Error(
      `Incomplete ${target} runtime: ${error.path}. Populate the platform payload and runtime-manifest.json.`,
      { cause: error },
    );
  }
  throw error;
});
const environment = {};
for (const key of [
  'LANG',
  'LC_ALL',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
]) {
  if (process.env[key] !== undefined) environment[key] = process.env[key];
}
environment.PATH = [
  path.dirname(path.join(root, manifest.recollindexExecutable)),
  ...manifest.helperDirectories.map((directory) => path.join(root, directory)),
].join(path.delimiter);
const result = spawnSync(
  path.join(root, manifest.recollindexExecutable),
  ['-V'],
  {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  },
);
if (
  result.error ||
  result.status !== 0 ||
  !`${result.stdout}\n${result.stderr}`.includes(manifest.recollVersion)
) {
  throw new Error(
    `Bundled recollindex -V failed or differs from ${manifest.recollVersion}.`,
    { cause: result.error },
  );
}
console.log(
  `Verified ${target} Recoll ${manifest.recollVersion} (${manifest.requiredFiles.length} files).`,
);
