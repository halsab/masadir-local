import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { targets, verifyRuntime } from './runtime-validation.mjs';

const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
if (!targets[target]) throw new Error(`Unsupported smoke target: ${target}`);
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const runtimeRoot = path.join(repository, 'assets', 'runtime', target);
const manifest = await verifyRuntime(runtimeRoot, target, {
  allowTemplate: true,
});
const fixtures = [
  ['pdf.pdf', 'pdfquartzember'],
  ['doc.doc', 'docbronzelantern'],
  ['docx.docx', 'docxsilverharbor'],
];
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), 'masadir-recoll-smoke-'),
);
const windowsThroughWine =
  target === 'win32-x64' && process.platform !== 'win32';

function run(command, args, environment, timeout = 60_000) {
  const result = spawnSync(command, args, {
    cwd: runtimeRoot,
    env: environment,
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message ?? result.stderr?.slice(-1500)}`,
      { cause: result.error },
    );
  }
  return result.stdout;
}

try {
  for (const directory of ['library', 'config', 'index', 'temp', 'home']) {
    await mkdir(path.join(temporaryRoot, directory));
  }
  for (const [filename] of fixtures) {
    await writeFile(
      path.join(temporaryRoot, 'library', filename),
      await readFile(
        path.join(repository, 'tests', 'fixtures', 'recoll', filename),
      ),
    );
  }

  const environment = {
    HOME: path.join(temporaryRoot, 'home'),
    LANG: 'C',
    PATH: [
      path.dirname(path.join(runtimeRoot, manifest.recollindexExecutable)),
      ...manifest.helperDirectories.map((directory) =>
        path.join(runtimeRoot, directory),
      ),
      ...(target === 'darwin-arm64' ? ['/usr/bin', '/bin'] : []),
      ...(windowsThroughWine
        ? [
            path.dirname(process.env.WINE ?? '/opt/homebrew/bin/wine'),
            '/usr/bin',
            '/bin',
          ]
        : []),
    ].join(path.delimiter),
    ...(windowsThroughWine
      ? { WINEPREFIX: path.join(temporaryRoot, 'wine'), WINEDEBUG: '-all' }
      : {}),
  };
  const wine = process.env.WINE ?? 'wine';
  const winepath = (localPath) =>
    run('winepath', ['-w', localPath], environment)
      .trim()
      .replaceAll('\\', '/');
  const configPath = path.join(temporaryRoot, 'config');
  const configValue = (localPath) =>
    windowsThroughWine ? winepath(localPath) : localPath;
  const configuration = [
    `topdirs = "${configValue(path.join(temporaryRoot, 'library'))}"`,
    `dbdir = ${configValue(path.join(temporaryRoot, 'index'))}`,
    'onlyNames = *.pdf *.doc *.docx',
    `recollhelperpath = ${manifest.helperDirectories.map((directory) => configValue(path.join(runtimeRoot, directory))).join(windowsThroughWine ? ';' : ':')}`,
    `idxrundir = ${configValue(path.join(temporaryRoot, 'temp'))}`,
    '',
  ].join('\n');
  await writeFile(path.join(configPath, 'recoll.conf'), configuration);

  const execute = (relative, args) =>
    windowsThroughWine
      ? run(wine, [path.join(runtimeRoot, relative), ...args], environment)
      : run(path.join(runtimeRoot, relative), args, environment);
  const recollConfig = configValue(configPath);
  execute(manifest.recollindexExecutable, ['-c', recollConfig, '-z']);
  for (const [filename, token] of fixtures) {
    const output = execute(manifest.recollqExecutable, [
      '-c',
      recollConfig,
      '-F',
      'url',
      token,
    ]);
    const matches = output
      .trim()
      .split(/\r?\n/u)
      .map((line) => Buffer.from(line.trim(), 'base64').toString('utf8'));
    if (!matches.some((url) => url.includes(filename))) {
      throw new Error(`${target} did not find ${filename} for ${token}.`);
    }
    console.log(`${target}: ${filename} OK`);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
