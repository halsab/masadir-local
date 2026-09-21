import { spawnSync } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { targets, verifyRuntime } from './runtime-validation.mjs';

const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
const staticOnly = process.argv.includes('--static-only');
if (!targets[target]) throw new Error(`Unsupported runtime target: ${target}`);
if (
  target !== `${process.platform}-${process.arch}` &&
  !(process.platform === 'darwin' && target === 'win32-x64')
) {
  throw new Error(
    'Verify runtime on its target platform or Windows through Wine on macOS.',
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
if (target === 'darwin-arm64') {
  let checked = 0;
  for (const relative of manifest.requiredFiles) {
    const binaryPath = path.join(root, relative);
    const handle = await open(binaryPath, 'r');
    const header = Buffer.alloc(4);
    try {
      await handle.read(header, 0, 4, 0);
    } finally {
      await handle.close();
    }
    const magic = header.readUInt32BE(0);
    if (
      ![
        0xcafebabe, 0xcafebabf, 0xcffaedfe, 0xcefaedfe, 0xfeedfacf, 0xfeedface,
      ].includes(magic)
    )
      continue;
    const result = spawnSync('otool', ['-L', binaryPath], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 128 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Could not inspect Mach-O dependencies: ${relative}.`);
    }
    for (const line of result.stdout.split('\n')) {
      if (!line.startsWith('\t')) continue;
      const dependency = line.trim().split(' (')[0];
      if (
        !dependency.startsWith('/System/Library/') &&
        !dependency.startsWith('/usr/lib/') &&
        !dependency.startsWith('@rpath/') &&
        !dependency.startsWith('@loader_path/') &&
        !dependency.startsWith('@executable_path/')
      ) {
        throw new Error(
          `External Mach-O dependency in ${relative}: ${dependency}`,
        );
      }
    }
    checked++;
  }
  const python = spawnSync(
    path.join(root, 'python/bin/python3'),
    ['--version'],
    {
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  if (
    python.error ||
    python.status !== 0 ||
    !`${python.stdout}${python.stderr}`.includes(manifest.helperVersions.Python)
  ) {
    throw new Error('Bundled Python version differs from runtime manifest.');
  }
  console.log(`Checked ${checked} Mach-O files and bundled Python.`);
}
if (staticOnly) {
  console.log(
    `Statically verified ${target} Recoll ${manifest.recollVersion} (${manifest.requiredFiles.length} files).`,
  );
  process.exit(0);
}
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
  ...(target === 'darwin-arm64' ? ['/usr/bin', '/bin'] : []),
  ...(target === 'win32-x64' && process.platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/bin', '/bin']
    : []),
].join(path.delimiter);
const throughWine = target === 'win32-x64' && process.platform === 'darwin';
const winePrefix = throughWine
  ? await mkdtemp(path.join(os.tmpdir(), 'masadir-recoll-verify-wine-'))
  : null;
if (winePrefix) {
  environment.WINEPREFIX = winePrefix;
  environment.WINEDEBUG = '-all';
  environment.HOME = winePrefix;
}
let result;
try {
  result = spawnSync(
    throughWine
      ? (process.env.WINE ?? 'wine')
      : path.join(root, manifest.recollindexExecutable),
    throughWine
      ? [path.join(root, manifest.recollindexExecutable), '-h']
      : ['-h'],
    {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    },
  );
} finally {
  if (winePrefix) await rm(winePrefix, { recursive: true, force: true });
}
if (
  result.error ||
  result.status !== 0 ||
  !`${result.stdout}\n${result.stderr}`.includes(manifest.recollVersion)
) {
  throw new Error(
    `Bundled recollindex -h failed or differs from ${manifest.recollVersion}.`,
    { cause: result.error },
  );
}
console.log(
  `Verified ${target} Recoll ${manifest.recollVersion} (${manifest.requiredFiles.length} files).`,
);
