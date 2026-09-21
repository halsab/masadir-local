import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import packageJson from './package.json';
import electronJson from 'electron/package.json';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const target =
  process.env.MASADIR_PACKAGE_TARGET ?? `${process.platform}-${process.arch}`;
const macIdentity = process.env.MASADIR_MAC_SIGN_IDENTITY;
const notaryProfile = process.env.MASADIR_NOTARY_KEYCHAIN_PROFILE;
const windowsCertificate = process.env.MASADIR_WINDOWS_CERTIFICATE_FILE;
const windowsCertificatePassword =
  process.env.MASADIR_WINDOWS_CERTIFICATE_PASSWORD;
const electronVersion = electronJson.version;
const electronZipDir = process.env.MASADIR_ELECTRON_ZIP_DIR;
const electronZip = electronZipDir
  ? path.join(electronZipDir, `electron-v${electronVersion}-${target}.zip`)
  : null;
const shouldFlipFuses = Boolean(macIdentity) || target !== 'darwin-arm64';

const buildTimestamp = (): string => {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch === undefined) return new Date().toISOString();
  if (!/^\d+$/u.test(epoch))
    throw new Error('SOURCE_DATE_EPOCH must be Unix seconds.');
  return new Date(Number(epoch) * 1000).toISOString();
};

if (notaryProfile && !macIdentity) {
  throw new Error('Notarization requires MASADIR_MAC_SIGN_IDENTITY.');
}
if (windowsCertificate && !windowsCertificatePassword) {
  throw new Error('Windows signing certificate requires its password.');
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    ...(electronZip && existsSync(electronZip) ? { electronZipDir } : {}),
    appBundleId: 'io.github.halsab.masadir.desktop',
    executableName: 'Masadir',
    extendInfo: { LSMinimumSystemVersion: '13.0' },
    extraResource: [
      path.join(__dirname, 'assets', 'runtime', target),
      path.join(__dirname, 'THIRD_PARTY_NOTICES.md'),
      path.join(__dirname, 'node_modules', 'electron', 'dist', 'LICENSE'),
      path.join(
        __dirname,
        'node_modules',
        'electron',
        'dist',
        'LICENSES.chromium.html',
      ),
    ],
    afterCopyExtraResources: [
      (buildPath, _electronVersion, platform, arch, callback) => {
        const resources = path.join(
          buildPath,
          ...(platform === 'darwin'
            ? [`${packageJson.productName}.app`, 'Contents', 'Resources']
            : ['resources']),
        );
        const runtimeRoot = path.join(resources, `${platform}-${arch}`);
        void (async () => {
          const manifest = JSON.parse(
            await readFile(
              path.join(runtimeRoot, 'runtime-manifest.json'),
              'utf8',
            ),
          ) as {
            recollVersion: string;
            helperVersions: Record<string, string>;
            indexCompatibilityVersion: string;
          };
          await unlink(
            path.join(runtimeRoot, 'runtime-manifest.template.json'),
          ).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          });
          await copyFile(
            path.join(
              __dirname,
              'node_modules',
              'electron-squirrel-startup',
              'LICENSE',
            ),
            path.join(resources, 'LICENSE.electron-squirrel-startup'),
          );
          await writeFile(
            path.join(resources, 'build-manifest.json'),
            JSON.stringify(
              {
                appId: 'io.github.halsab.masadir.desktop',
                masadirVersion: packageJson.version,
                electronVersion,
                recollVersion: manifest.recollVersion,
                helperVersions: manifest.helperVersions,
                platform,
                arch,
                buildTimestamp: buildTimestamp(),
                indexCompatibilityVersion: manifest.indexCompatibilityVersion,
              },
              null,
              2,
            ) + '\n',
          );
        })().then(() => callback(), callback);
      },
    ],
    ...(macIdentity ? { osxSign: { identity: macIdentity } } : {}),
    ...(notaryProfile
      ? { osxNotarize: { keychainProfile: notaryProfile } }
      : {}),
  },
  rebuildConfig: {},
  makers: [new MakerDMG({})],
  hooks: {
    prePackage: async (_forgeConfig, platform, arch) => {
      if (
        `${platform}-${arch}` !== target ||
        !['darwin-arm64', 'win32-x64'].includes(target)
      ) {
        throw new Error(
          `Unsupported package target ${platform}-${arch}; set MASADIR_PACKAGE_TARGET for a cross-build.`,
        );
      }
      execFileSync(
        process.execPath,
        [
          path.join(__dirname, 'scripts', 'verify-runtime.mjs'),
          target,
          ...(target === 'win32-x64' ? ['--static-only'] : []),
        ],
        {
          cwd: __dirname,
          stdio: 'inherit',
        },
      );
    },
  },
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/index.ts',
            name: 'main_window',
            preload: {
              js: './src/preload/index.ts',
            },
          },
        ],
      },
    }),
    ...(shouldFlipFuses
      ? [
          new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
          }),
        ]
      : []),
  ],
};

export default config;
