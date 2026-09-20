import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import {
  IpcChannel,
  type BookStatusChangedEvent,
  type IndexStateChangedEvent,
  type IpcResult,
  type MasadirApi,
} from '../shared/contracts';

const invoke = <T>(
  channel: string,
  ...args: unknown[]
): Promise<IpcResult<T>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>;

const api: MasadirApi = {
  app: {
    getSnapshot: () => invoke(IpcChannel.appGetSnapshot),
  },
  library: {
    addBooks: () => invoke(IpcChannel.libraryAddBooks),
    chooseRoot: () => invoke(IpcChannel.libraryChooseRoot),
    listBooks: () => invoke(IpcChannel.libraryListBooks),
    trashBook: (bookId) => invoke(IpcChannel.libraryTrashBook, bookId),
    retryIndex: (bookId) => invoke(IpcChannel.libraryRetryIndex, bookId),
    openFolder: () => invoke(IpcChannel.libraryOpenFolder),
  },
  search: {
    searchBooks: (query, page) => invoke(IpcChannel.searchBooks, query, page),
    searchMatches: (bookId, limit) =>
      invoke(IpcChannel.searchMatches, bookId, limit),
    cancel: () => invoke(IpcChannel.searchCancel),
  },
  document: {
    open: (bookId, pageNumber) =>
      invoke(IpcChannel.documentOpen, bookId, pageNumber),
  },
  clipboard: {
    writeText: (text) => invoke(IpcChannel.clipboardWriteText, text),
  },
  events: {
    onBookStatusChanged: (callback) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: BookStatusChangedEvent,
      ): void => callback(payload);

      ipcRenderer.on(IpcChannel.bookStatusChanged, listener);
      return () =>
        ipcRenderer.removeListener(IpcChannel.bookStatusChanged, listener);
    },
    onIndexStateChanged: (callback) => {
      const listener = (
        _event: IpcRendererEvent,
        payload: IndexStateChangedEvent,
      ): void => callback(payload);

      ipcRenderer.on(IpcChannel.indexStateChanged, listener);
      return () =>
        ipcRenderer.removeListener(IpcChannel.indexStateChanged, listener);
    },
  },
};

contextBridge.exposeInMainWorld('masadir', api);
