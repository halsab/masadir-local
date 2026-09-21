import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const target = `${process.platform}-${process.arch}`;
const macIdentity = process.env.MASADIR_MAC_SIGN_IDENTITY;
const notaryProfile = process.env.MASADIR_NOTARY_KEYCHAIN_PROFILE;
const windowsCertificate = process.env.MASADIR_WINDOWS_CERTIFICATE_FILE;
const windowsCertificatePassword = process.env.MASADIR_WINDOWS_CERTIFICATE_PASSWORD;

if (notaryProfile && !macIdentity) {
  throw new Error('Notarization requires MASADIR_MAC_SIGN_IDENTITY.');
}
if (windowsCertificate && !windowsCertificatePassword) {
  throw new Error('Windows signing certificate requires its password.');
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appBundleId: 'io.github.halsab.masadir.desktop',
    executableName: 'Masadir',
    extraResource: [path.join(__dirname, 'assets', 'runtime', target)],
    ignore: [/[/\\]assets[/\\]runtime(?:[/\\]|$)/u],
    ...(macIdentity ? { osxSign: { identity: macIdentity } } : {}),
    ...(notaryProfile
      ? { osxNotarize: { keychainProfile: notaryProfile } }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({}),
    new MakerSquirrel({
      noMsi: true,
      setupExe: 'Masadir-Setup.exe',
      ...(windowsCertificate
        ? {
            certificateFile: windowsCertificate,
            certificatePassword: windowsCertificatePassword,
          }
        : {}),
    }),
  ],
  hooks: {
    prePackage: async (platform, arch) => {
      if (`${platform}-${arch}` !== target || !['darwin-arm64', 'win32-x64'].includes(target)) {
        throw new Error(`Build on the matching supported host for ${platform}-${arch}.`);
      }
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
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
