import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';

import { createMainWindow } from './app/create-main-window';

if (started) {
  app.quit();
}

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
