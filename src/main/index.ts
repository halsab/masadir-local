import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import { AppError, ErrorCode, type AppSnapshot } from '../shared/contracts';
import { createMainWindow } from './app/create-main-window';
import { registerIpcHandlers } from './app/register-ipc-handlers';
import { createAppPaths, ensureAppPaths } from './platform/app-paths';
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

    const getSnapshot = (): AppSnapshot => ({
      appVersion: app.getVersion(),
      libraryRoot: settings.libraryRoot,
      books: [],
    });

    registerIpcHandlers({
      diagnostics,
      getSnapshot,
      rendererUrl: MAIN_WINDOW_WEBPACK_ENTRY,
    });

    await diagnostics.info('app-started');
    createMainWindow();

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
