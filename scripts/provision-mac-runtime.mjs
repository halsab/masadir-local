import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { finalizeRuntime } from './finalize-runtime.mjs';

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const root = path.join(repository, 'assets', 'runtime', 'darwin-arm64');
const template = JSON.parse(
  await readFile(path.join(root, 'runtime-manifest.template.json'), 'utf8'),
);
const temporaryRoot = await mkdtemp('/private/tmp/masadir-recoll-provision-');

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: environment,
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

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function artifact(source, localPath) {
  const file = localPath ?? path.join(temporaryRoot, source.filename);
  if (!localPath) run('curl', ['-fL', '--retry', '2', '-o', file, source.url]);
  if (!(await stat(file)).isFile() || (await sha256(file)) !== source.sha256) {
    throw new Error(`Source artifact SHA-256 differs: ${source.filename}`);
  }
  return file;
}

let mounted = false;
let keyring = null;
try {
  const dmg = await artifact(
    template.sourceArtifact,
    process.env.RECOLL_MAC_DMG,
  );
  const pythonArchive = await artifact(template.additionalArtifacts[0]);
  const signature = path.join(temporaryRoot, 'recoll.dmg.asc');
  const keyPage = path.join(temporaryRoot, 'recoll-key.html');
  const keyFile = path.join(temporaryRoot, 'recoll-key.asc');
  keyring = await mkdtemp('/private/tmp/masadir-gpg-');
  run('curl', ['-fL', '-o', signature, template.sourceArtifact.signatureUrl]);
  run('curl', [
    '-fL',
    '-o',
    keyPage,
    'https://www.recoll.org/pages/dockes-key.html',
  ]);
  const keyBlock = (await readFile(keyPage, 'utf8'))
    .match(
      /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/u,
    )?.[0]
    .replace(/<[^>]*>/gu, '');
  if (!keyBlock) throw new Error('Recoll signing key was not found.');
  await writeFile(keyFile, `${keyBlock}\n`);
  const gpgEnvironment = { ...process.env, GNUPGHOME: keyring };
  const fingerprints = spawnSync(
    'gpg',
    ['--batch', '--show-keys', '--with-colons', keyFile],
    {
      env: gpgEnvironment,
      encoding: 'utf8',
    },
  );
  if (
    fingerprints.error ||
    fingerprints.status !== 0 ||
    !fingerprints.stdout.includes(template.sourceArtifact.signerFingerprint)
  ) {
    throw new Error('Recoll signing key fingerprint differs.');
  }
  run('gpg', ['--batch', '--import', keyFile], gpgEnvironment);
  run('gpg', ['--batch', '--verify', signature, dmg], gpgEnvironment);
  const mountpoint = path.join(temporaryRoot, 'mount');
  const staging = path.join(temporaryRoot, 'staging');
  await mkdir(mountpoint);
  await mkdir(staging);
  run('hdiutil', [
    'attach',
    '-readonly',
    '-nobrowse',
    '-quiet',
    '-mountpoint',
    mountpoint,
    dmg,
  ]);
  mounted = true;
  run('ditto', [
    path.join(mountpoint, 'recoll.app'),
    path.join(staging, 'recoll.app'),
  ]);
  await mkdir(path.join(staging, 'python'));
  run('tar', [
    '-xzf',
    pythonArchive,
    '-C',
    path.join(staging, 'python'),
    '--strip-components=1',
  ]);

  const python = path.join(staging, 'python');
  for (const relative of [
    'lib/python3.11/site-packages',
    'lib/python3.11/ensurepip',
    'lib/python3.11/tkinter',
    'lib/python3.11/turtledemo',
    'lib/python3.11/lib-dynload/_tkinter.cpython-311-darwin.so',
    'lib/tcl9.0',
    'lib/tcl9',
    'lib/tk9.0',
    'lib/itcl4.3.8',
    'lib/thread3.0.6',
    'lib/libtcl9.0.dylib',
    'lib/libtcl9tk9.0.dylib',
    'bin/pip',
    'bin/pip3',
    'bin/pip3.11',
    'bin/idle3',
    'bin/idle3.11',
  ]) {
    await rm(path.join(python, relative), { recursive: true, force: true });
  }

  await rm(path.join(root, 'recoll.app'), { recursive: true, force: true });
  await rm(path.join(root, 'python'), { recursive: true, force: true });
  await rename(path.join(staging, 'recoll.app'), path.join(root, 'recoll.app'));
  await rename(python, path.join(root, 'python'));
  const manifest = await finalizeRuntime('darwin-arm64', [
    [dmg, template.sourceArtifact.filename, template.sourceArtifact.sha256],
    [
      pythonArchive,
      template.additionalArtifacts[0].filename,
      template.additionalArtifacts[0].sha256,
    ],
  ]);
  console.log(`Provisioned macOS Recoll ${manifest.recollVersion}.`);
} finally {
  if (mounted) {
    run('hdiutil', ['detach', '-quiet', path.join(temporaryRoot, 'mount')]);
  }
  // На macOS GnuPG нужен короткий путь к IPC-сокету.
  if (keyring) await rm(keyring, { recursive: true, force: true });
  await rm(temporaryRoot, { recursive: true, force: true });
}
