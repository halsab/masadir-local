import { BrowserWindow, type WebContents } from 'electron';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

const lockDownWebContents = (webContents: WebContents): void => {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
};

export const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });

  lockDownWebContents(window.webContents);
  window.once('ready-to-show', () => window.show());
  void window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  return window;
};
