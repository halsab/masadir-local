import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, dialog, shell } from 'electron';
import started from 'electron-squirrel-startup';

import { AppError, ErrorCode, type AppSnapshot } from '../shared/contracts';
import { createMainWindow } from './app/create-main-window';
import { registerIpcHandlers } from './app/register-ipc-handlers';
import { LibraryService } from './library/library-service';
import { IndexService } from './library/index-service';
import { LibraryStateStore } from './library/library-state-store';
import { assertLibraryRootLocation } from './library/path-safety';
import { createAppPaths, ensureAppPaths } from './platform/app-paths';
import { IndexMetadataStore } from './recoll/index-metadata-store';
import { RecollAdapter } from './recoll/recoll-adapter';
import { RuntimeResolver } from './recoll/runtime-resolver';
import { DiagnosticsService } from './services/diagnostics-service';
import { SettingsService, type Settings } from './services/settings-service';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;

if (started) {
  app.quit();
}

app
  .whenReady()
  .then(async () => {
    const paths = createAppPaths(app.getPath('userData'));
    await ensureAppPaths(paths);

    const diagnostics = new DiagnosticsService(paths.logs);
    const settingsService = new SettingsService(paths.settingsFile);
    let settings: Settings;
    try {
      settings = await settingsService.load();
    } catch (error) {
      await diagnostics.error('settings-load-failed', {
        code: error instanceof AppError ? error.code : ErrorCode.internal,
      });
      throw error;
    }

    const stateStore = new LibraryStateStore(paths.libraryStateFile);
    const initialRoot =
      settings.libraryRoot ??
      path.join(app.getPath('documents'), 'Masādir Library');
    const recollAdapter = new RecollAdapter({
      resolver: new RuntimeResolver({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      }),
      paths,
      libraryRoot: initialRoot,
    });
    const indexService = new IndexService(
      recollAdapter,
      stateStore,
      new IndexMetadataStore(paths.recollIndex),
      initialRoot,
    );
    const library = new LibraryService({
      dialogs: {
        chooseDirectory: async () => {
          const result = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
        chooseBooks: async () => {
          const result = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Книги', extensions: ['pdf', 'doc', 'docx'] }],
          });
          return result.canceled ? [] : result.filePaths;
        },
        confirmConflict: async (originalName, availableName) => {
          const result = await dialog.showMessageBox({
            type: 'question',
            message: `Файл «${originalName}» уже есть в библиотеке.`,
            detail: `Импортировать как «${availableName}»?`,
            buttons: ['Импортировать', 'Пропустить'],
            defaultId: 0,
            cancelId: 1,
          });
          return result.response === 0;
        },
        confirmTrash: async (fileName) => {
          const result = await dialog.showMessageBox({
            type: 'warning',
            message: `Переместить «${fileName}» в Корзину?`,
            buttons: ['Переместить в Корзину', 'Отмена'],
            defaultId: 1,
            cancelId: 1,
          });
          return result.response === 0;
        },
      },
      forbiddenRoots: [app.getAppPath(), app.getPath('userData')],
      indexService,
      settings,
      settingsService,
      shell: {
        trashItem: (filePath) => shell.trashItem(filePath),
        showItemInFolder: (filePath) => shell.showItemInFolder(filePath),
      },
      stateStore,
    });

    try {
      const rootPath = initialRoot;
      await mkdir(rootPath, { recursive: true });
      const root = await assertLibraryRootLocation(rootPath, [
        app.getAppPath(),
        app.getPath('userData'),
      ]);
      if (settings.libraryRoot !== root) {
        settings.libraryRoot = root;
        await settingsService.save(settings);
      }
      await library.initializeRoot(root);
    } catch (error) {
      await diagnostics.error('library-reconcile-failed', {
        code: error instanceof AppError ? error.code : ErrorCode.ioError,
      });
    }
    const runtimeInfo = indexService.getRuntimeInfo();
    await diagnostics.info('recoll-preflight', {
      runtimeState: runtimeInfo.state,
      runtimeFingerprint: runtimeInfo.runtimeFingerprint,
      recollVersion: runtimeInfo.recollVersion,
      indexCompatibilityVersion: runtimeInfo.indexCompatibilityVersion,
    });

    const getSnapshot = (): AppSnapshot => ({
      appVersion: app.getVersion(),
      library: library.getState(),
    });

    registerIpcHandlers({
      diagnostics,
      getSnapshot,
      library,
      rendererUrl: MAIN_WINDOW_WEBPACK_ENTRY,
    });

    await diagnostics.info('app-started');
    createMainWindow();

    app.on('before-quit', () => recollAdapter.shutdown());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  })
  .catch(() => app.quit());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
