import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { app, BrowserWindow, dialog, shell } from 'electron';
import started from 'electron-squirrel-startup';

import {
  AppError,
  ErrorCode,
  IpcChannel,
  type AppSnapshot,
} from '../shared/contracts';
import { createMainWindow } from './app/create-main-window';
import { registerIpcHandlers } from './app/register-ipc-handlers';
import { DocumentService } from './document/document-service';
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
import { SearchService } from './search/search-service';

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
    const sendToRenderers = (channel: string, payload: unknown): void => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(channel, payload);
      }
    };
    const indexService = new IndexService(
      recollAdapter,
      stateStore,
      new IndexMetadataStore(paths.recollIndex),
      initialRoot,
      {
        bookStatusChanged: (bookId, status) =>
          sendToRenderers(IpcChannel.bookStatusChanged, { bookId, status }),
        indexStateChanged: (state) =>
          sendToRenderers(IpcChannel.indexStateChanged, { state }),
      },
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
        openPath: (filePath) => shell.openPath(filePath),
        trashItem: (filePath) => shell.trashItem(filePath),
      },
      stateStore,
    });
    const search = new SearchService(recollAdapter, indexService, library, {
      settings,
      settingsService,
    });
    const document = new DocumentService(library, {
      openPath: (filePath) => shell.openPath(filePath),
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
      libraryRoot: settings.libraryRoot,
      library: library.getState(),
      runtimeState: indexService.getRuntimeInfo().state,
      indexState: indexService.getState(),
      searchState: search.getState(),
      recentQueries: [...settings.recentQueries],
    });

    registerIpcHandlers({
      diagnostics,
      document,
      getSnapshot,
      library,
      rendererUrl: MAIN_WINDOW_WEBPACK_ENTRY,
      search,
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
