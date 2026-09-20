import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createRuntimeFingerprint,
  parseRuntimeManifest,
  type RuntimeManifest,
} from './runtime-manifest';

export type SupportedRuntimeTarget = 'darwin-arm64' | 'win32-x64';

export interface RecollRuntime {
  target: SupportedRuntimeTarget;
  root: string;
  manifestPath: string;
  manifest: RuntimeManifest;
  recollindexExecutable: string;
  recollqExecutable: string;
  helperDirectories: string[];
  requiredFiles: string[];
  runtimeFingerprint: string;
}

export interface RuntimeResolverOptions {
  appPath: string;
  isPackaged: boolean;
  resourcesPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

const getTarget = (
  platform: NodeJS.Platform,
  arch: string,
): SupportedRuntimeTarget => {
  if (platform === 'darwin' && arch === 'arm64') {
    return 'darwin-arm64';
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'win32-x64';
  }
  throw new Error(`Unsupported Recoll runtime target: ${platform}-${arch}.`);
};

export class RuntimeResolver {
  constructor(private readonly options: RuntimeResolverOptions) {}

  getTarget(): SupportedRuntimeTarget {
    return getTarget(
      this.options.platform ?? process.platform,
      this.options.arch ?? process.arch,
    );
  }

  getRuntimeRoot(): string {
    if (this.options.isPackaged) {
      return path.resolve(this.options.resourcesPath);
    }
    return path.resolve(
      this.options.appPath,
      'assets',
      'runtime',
      this.getTarget(),
    );
  }

  async resolve(): Promise<RecollRuntime> {
    const target = this.getTarget();
    const root = this.getRuntimeRoot();
    const manifestPath = path.join(root, 'runtime-manifest.json');
    const serialized = await readFile(manifestPath, 'utf8');
    const manifest = parseRuntimeManifest(JSON.parse(serialized) as unknown);

    return {
      target,
      root,
      manifestPath,
      manifest,
      recollindexExecutable: path.join(root, manifest.recollindexExecutable),
      recollqExecutable: path.join(root, manifest.recollqExecutable),
      helperDirectories: manifest.helperDirectories.map((directory) =>
        path.join(root, directory),
      ),
      requiredFiles: manifest.requiredFiles.map((file) => path.join(root, file)),
      runtimeFingerprint: createRuntimeFingerprint(manifest),
    };
  }
}
