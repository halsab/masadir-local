import { spawnSync } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import installer from 'electron-winstaller';

import { verifyRuntime } from './runtime-validation.mjs';

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const packageJson = JSON.parse(
  await readFile(path.join(repository, 'package.json'), 'utf8'),
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    stdio: 'inherit',
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? result.error?.message}).`,
      {
        cause: result.error,
      },
    );
  }
}

for (const tool of ['wine', 'mono']) {
  const result = spawnSync(tool, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${tool} is required on this Mac for the Windows cross-build. Install Wine and Mono before running make:win.`,
    );
  }
}

await verifyRuntime(
  path.join(repository, 'assets', 'runtime', 'win32-x64'),
  'win32-x64',
  { allowTemplate: true },
);
run(
  'npm',
  ['exec', '--', 'electron-forge', 'package', '--platform=win32', '--arch=x64'],
  {
    env: { ...process.env, MASADIR_PACKAGE_TARGET: 'win32-x64' },
  },
);
run(process.execPath, [
  'scripts/verify-package.mjs',
  'win32-x64',
  '--bundle-only',
]);

const appDirectory = path.join(
  repository,
  'out',
  `${packageJson.productName}-win32-x64`,
);
if (!(await stat(path.join(appDirectory, 'Masadir.exe'))).isFile()) {
  throw new Error('Forge did not create the Windows app executable.');
}
const outputDirectory = path.join(
  repository,
  'out',
  'make',
  'squirrel.windows',
  'x64',
);
await rm(outputDirectory, { recursive: true, force: true });

const certificateFile = process.env.MASADIR_WINDOWS_CERTIFICATE_FILE;
const certificatePassword = process.env.MASADIR_WINDOWS_CERTIFICATE_PASSWORD;
if (Boolean(certificateFile) !== Boolean(certificatePassword)) {
  throw new Error(
    'Windows signing requires both certificate file and password.',
  );
}

await installer.createWindowsInstaller({
  appDirectory,
  outputDirectory,
  authors: packageJson.author ?? 'Masādir',
  description: packageJson.description,
  exe: 'Masadir.exe',
  name: 'masadir_desktop',
  title: packageJson.productName,
  version: packageJson.version,
  noMsi: true,
  setupExe: 'Masadir-Setup.exe',
  ...(certificateFile ? { certificateFile, certificatePassword } : {}),
});

run(process.execPath, ['scripts/verify-package.mjs', 'win32-x64']);
