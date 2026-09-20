import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export interface AppPaths {
  root: string;
  settingsFile: string;
  libraryStateFile: string;
  recollConfig: string;
  recollIndex: string;
  logs: string;
  runtimeTemp: string;
}

export const createAppPaths = (userDataPath: string): AppPaths => {
  const root = path.join(userDataPath, 'Masadir');

  return {
    root,
    settingsFile: path.join(root, 'settings.json'),
    libraryStateFile: path.join(root, 'state.json'),
    recollConfig: path.join(root, 'recoll', 'config'),
    recollIndex: path.join(root, 'recoll', 'index'),
    logs: path.join(root, 'logs'),
    runtimeTemp: path.join(root, 'runtime', 'temp'),
  };
};

export const ensureAppPaths = async (paths: AppPaths): Promise<void> => {
  await Promise.all([
    mkdir(paths.root, { recursive: true }),
    mkdir(paths.recollConfig, { recursive: true }),
    mkdir(paths.recollIndex, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
    mkdir(paths.runtimeTemp, { recursive: true }),
  ]);
};
