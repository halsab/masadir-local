import type { IpcMainInvokeEvent } from 'electron';

import { AppError, ErrorCode } from '../../shared/contracts';

export const assertTrustedSender = (
  event: IpcMainInvokeEvent,
  rendererUrl: string,
): void => {
  const frame = event.senderFrame;

  if (frame === null || frame.parent !== null || frame.url !== rendererUrl) {
    throw new AppError(
      ErrorCode.unauthorized,
      'Источник IPC-запроса не разрешён.',
    );
  }
};
