import { clipboard, ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
  IpcChannel,
  type AppSnapshot,
  type InvokeChannel,
  type IpcResult,
  toIpcErrorResult,
  toIpcResult,
} from '../../shared/contracts';
import type { DiagnosticsService } from '../services/diagnostics-service';
import type { DocumentService } from '../document/document-service';
import type { LibraryService } from '../library/library-service';
import type { SearchService } from '../search/search-service';
import {
  parseBookIdArgs,
  parseClipboardWriteArgs,
  parseDocumentOpenArgs,
  parseNoArgs,
  parseSearchBooksArgs,
  parseSearchMatchesArgs,
} from './ipc-validation';
import { assertTrustedSender } from './trusted-sender';

interface RegisterIpcHandlersOptions {
  diagnostics: DiagnosticsService;
  document: DocumentService;
  getSnapshot: () => AppSnapshot;
  library: LibraryService;
  rendererUrl: string;
  search: SearchService;
}

type ArgsParser<TArgs extends unknown[]> = (args: unknown[]) => TArgs;

export const registerIpcHandlers = ({
  diagnostics,
  document,
  getSnapshot,
  library,
  rendererUrl,
  search,
}: RegisterIpcHandlersOptions): void => {
  const handle = <TArgs extends unknown[], TResult>(
    channel: InvokeChannel,
    parseArgs: ArgsParser<TArgs>,
    action: (...args: TArgs) => TResult | Promise<TResult>,
  ): void => {
    ipcMain.handle(
      channel,
      async (
        event: IpcMainInvokeEvent,
        ...rawArgs: unknown[]
      ): Promise<IpcResult<TResult>> => {
        try {
          assertTrustedSender(event, rendererUrl);
          const args = parseArgs(rawArgs);
          return toIpcResult(await action(...args));
        } catch (error) {
          const result = toIpcErrorResult(error);
          await diagnostics.error('ipc-request-failed', {
            channel,
            code: result.error.code,
          });
          return result;
        }
      },
    );
  };

  handle(IpcChannel.appGetSnapshot, parseNoArgs, getSnapshot);
  handle(IpcChannel.libraryAddBooks, parseNoArgs, () => library.addBooks());
  handle(IpcChannel.libraryChooseRoot, parseNoArgs, () => library.chooseRoot());
  handle(IpcChannel.libraryListBooks, parseNoArgs, () => library.listBooks());
  handle(IpcChannel.libraryTrashBook, parseBookIdArgs, (bookId) =>
    library.trashBook(bookId),
  );
  handle(IpcChannel.libraryRetryIndex, parseBookIdArgs, (bookId) =>
    library.retryIndex(bookId),
  );
  handle(IpcChannel.libraryOpenFolder, parseNoArgs, () => library.openFolder());
  handle(IpcChannel.searchBooks, parseSearchBooksArgs, (query, page) =>
    search.searchBooks(query, page),
  );
  handle(IpcChannel.searchMatches, parseSearchMatchesArgs, (bookId, limit) =>
    search.searchMatches(bookId, limit),
  );
  handle(IpcChannel.searchCancel, parseNoArgs, () => search.cancel());
  handle(IpcChannel.documentOpen, parseDocumentOpenArgs, (...args) =>
    document.open(args[0], args[1]),
  );
  handle(IpcChannel.clipboardWriteText, parseClipboardWriteArgs, (text) => {
    clipboard.writeText(text);
  });
};
