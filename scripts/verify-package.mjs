import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import asar from '@electron/asar';
import fusesPackage from '@electron/fuses';

import { targets, verifyRuntime } from './runtime-validation.mjs';

const { FuseV1Options, FuseVersion, getCurrentFuseWire } = fusesPackage;
// Состояния fuse хранятся байтами ASCII '0' и '1'; пакет не экспортирует FuseState.
const FuseState = { DISABLE: 48, ENABLE: 49 };

const target = process.argv[2] ?? `${process.platform}-${process.arch}`;
if (!targets[target]) throw new Error(`Unsupported package target: ${target}`);
const bundleOnly = process.argv.includes('--bundle-only');
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const packageJson = JSON.parse(
  await readFile(path.join(repository, 'package.json'), 'utf8'),
);
const electronJson = JSON.parse(
  await readFile(
    path.join(repository, 'node_modules/electron/package.json'),
    'utf8',
  ),
);
const { platform, arch } = targets[target];
const appName = packageJson.productName;
const appDir = path.join(repository, 'out', `${appName}-${target}`);
const app =
  platform === 'darwin' ? path.join(appDir, `${appName}.app`) : appDir;
const resources = path.join(
  app,
  ...(platform === 'darwin' ? ['Contents', 'Resources'] : ['resources']),
);
const executable =
  platform === 'darwin'
    ? path.join(app, 'Contents', 'MacOS', 'Masadir')
    : path.join(app, 'Masadir.exe');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fileExists(file) {
  const metadata = await stat(file).catch((error) => {
    if (error.code === 'ENOENT')
      throw new Error(`Missing package file: ${file}`);
    throw error;
  });
  assert(metadata.isFile(), `Expected file: ${file}`);
}

const artifact =
  platform === 'darwin'
    ? path.join(
        repository,
        'out',
        'make',
        `${appName}-${packageJson.version}-${arch}.dmg`,
      )
    : path.join(
        repository,
        'out',
        'make',
        'squirrel.windows',
        arch,
        'Masadir-Setup.exe',
      );
if (!bundleOnly) {
  await fileExists(artifact);
  assert(
    (await stat(artifact)).size > 0,
    `Empty installable artifact: ${artifact}`,
  );
}
if (platform === 'win32' && !bundleOnly) {
  await fileExists(
    path.join(repository, 'out', 'make', 'squirrel.windows', arch, 'RELEASES'),
  );
  await fileExists(
    path.join(
      repository,
      'out',
      'make',
      'squirrel.windows',
      arch,
      `masadir_desktop-${packageJson.version}-full.nupkg`,
    ),
  );
  const packageEntries = execFileSync(
    'unzip',
    [
      '-Z1',
      path.join(
        repository,
        'out',
        'make',
        'squirrel.windows',
        arch,
        `masadir_desktop-${packageJson.version}-full.nupkg`,
      ),
    ],
    { encoding: 'utf8' },
  ).replaceAll('\\', '/');
  for (const entry of [
    'Masadir.exe',
    'resources/app.asar',
    `resources/${target}/runtime-manifest.json`,
    `resources/${target}/`,
  ]) {
    assert(packageEntries.includes(entry), `NuGet package lacks ${entry}.`);
  }
}

await fileExists(executable);
const asarPath = path.join(resources, 'app.asar');
await fileExists(asarPath);
const packagedJson = JSON.parse(
  asar.extractFile(asarPath, 'package.json').toString('utf8'),
);
assert(
  packagedJson.version === packageJson.version &&
    packagedJson.productName === appName,
  'Packaged application identity/version differs from package.json.',
);
assert(
  !asar
    .listPackage(asarPath)
    .some((entry) => entry.replaceAll('\\', '/').includes('assets/runtime/')),
  'Runtime payload was copied into app.asar.',
);

const runtimeRoot = path.join(resources, target);
const manifest = await verifyRuntime(runtimeRoot, target);
const sourceManifest = JSON.parse(
  await readFile(
    path.join(repository, 'assets', 'runtime', target, 'runtime-manifest.json'),
    'utf8',
  ),
);
assert(
  JSON.stringify(manifest) === JSON.stringify(sourceManifest),
  'Packaged runtime differs from the current pinned runtime.',
);
const resolvedIndexer = path.resolve(
  resources,
  target,
  manifest.recollindexExecutable,
);
const resolvedQuery = path.resolve(
  resources,
  target,
  manifest.recollqExecutable,
);
await fileExists(resolvedIndexer);
await fileExists(resolvedQuery);
assert(
  resolvedIndexer.startsWith(`${runtimeRoot}${path.sep}`) &&
    resolvedQuery.startsWith(`${runtimeRoot}${path.sep}`),
  'RuntimeResolver executable paths escape packaged resources.',
);

const build = JSON.parse(
  await readFile(path.join(resources, 'build-manifest.json'), 'utf8'),
);
assert(
  build.appId === 'io.github.halsab.masadir.desktop' &&
    build.masadirVersion === packageJson.version &&
    build.electronVersion === electronJson.version &&
    build.recollVersion === manifest.recollVersion &&
    JSON.stringify(build.helperVersions) ===
      JSON.stringify(manifest.helperVersions) &&
    build.platform === platform &&
    build.arch === arch &&
    build.indexCompatibilityVersion === manifest.indexCompatibilityVersion &&
    !Number.isNaN(Date.parse(build.buildTimestamp)),
  'Build manifest differs from packaged runtime.',
);

for (const license of [
  'THIRD_PARTY_NOTICES.md',
  'LICENSE',
  'LICENSES.chromium.html',
  'LICENSE.electron-squirrel-startup',
]) {
  await fileExists(path.join(resources, license));
}
if (platform === 'darwin') {
  const plist = path.join(app, 'Contents', 'Info.plist');
  const value = (key) =>
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], {
      encoding: 'utf8',
    }).trim();
  assert(
    value('CFBundleIdentifier') === build.appId &&
      value('CFBundleShortVersionString') === packageJson.version &&
      value('LSMinimumSystemVersion') === '13.0',
    'macOS app identity/version/minimum OS differs.',
  );
}

const fuses = await getCurrentFuseWire(executable);
assert(fuses.version === FuseVersion.V1, 'Unexpected fuse version.');
for (const [fuse, state] of [
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
]) {
  assert(
    fuses[fuse] === state,
    `Unexpected Electron fuse: ${FuseV1Options[fuse]}`,
  );
}
console.log(`Verified ${target} ${bundleOnly ? 'app bundle' : artifact}.`);
