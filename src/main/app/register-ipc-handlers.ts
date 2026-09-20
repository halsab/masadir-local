import { clipboard, ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
  AppError,
  ErrorCode,
  IpcChannel,
  type AppSnapshot,
  type InvokeChannel,
  type IpcResult,
  toIpcErrorResult,
  toIpcResult,
} from '../../shared/contracts';
import type { DiagnosticsService } from '../services/diagnostics-service';
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
  getSnapshot: () => AppSnapshot;
  rendererUrl: string;
}

type ArgsParser<TArgs extends unknown[]> = (args: unknown[]) => TArgs;

const notImplemented = (..._args: unknown[]): never => {
  void _args;
  throw new AppError(ErrorCode.notImplemented, 'Функция пока недоступна.');
};

export const registerIpcHandlers = ({
  diagnostics,
  getSnapshot,
  rendererUrl,
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
  handle(IpcChannel.libraryAddBooks, parseNoArgs, notImplemented);
  handle(IpcChannel.libraryChooseRoot, parseNoArgs, notImplemented);
  handle(IpcChannel.libraryListBooks, parseNoArgs, notImplemented);
  handle(IpcChannel.libraryTrashBook, parseBookIdArgs, notImplemented);
  handle(IpcChannel.libraryRetryIndex, parseBookIdArgs, notImplemented);
  handle(IpcChannel.libraryOpenFolder, parseNoArgs, notImplemented);
  handle(IpcChannel.searchBooks, parseSearchBooksArgs, notImplemented);
  handle(IpcChannel.searchMatches, parseSearchMatchesArgs, notImplemented);
  handle(IpcChannel.searchCancel, parseNoArgs, notImplemented);
  handle(IpcChannel.documentOpen, parseDocumentOpenArgs, notImplemented);
  handle(IpcChannel.clipboardWriteText, parseClipboardWriteArgs, (text) => {
    clipboard.writeText(text);
  });
};
