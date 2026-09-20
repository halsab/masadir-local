export const IpcChannel = {
  appGetSnapshot: 'app:get-snapshot',
  libraryAddBooks: 'library:add-books',
  libraryChooseRoot: 'library:choose-root',
  libraryListBooks: 'library:list-books',
  libraryTrashBook: 'library:trash-book',
  libraryRetryIndex: 'library:retry-index',
  libraryOpenFolder: 'library:open-folder',
  searchBooks: 'search:books',
  searchMatches: 'search:matches',
  searchCancel: 'search:cancel',
  documentOpen: 'document:open',
  clipboardWriteText: 'clipboard:write-text',
  bookStatusChanged: 'events:book-status-changed',
  indexStateChanged: 'events:index-state-changed',
} as const;

export type InvokeChannel = Exclude<
  (typeof IpcChannel)[keyof typeof IpcChannel],
  | typeof IpcChannel.bookStatusChanged
  | typeof IpcChannel.indexStateChanged
>;
