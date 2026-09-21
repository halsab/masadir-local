import type { IpcMainInvokeEvent } from 'electron';

import { AppError, ErrorCode } from '../../shared/contracts';

export const isTrustedRendererUrl = (
  senderUrl: string,
  rendererUrl: string,
): boolean => {
  try {
    const sender = new URL(senderUrl);
    const renderer = new URL(rendererUrl);
    return (
      sender.protocol === renderer.protocol &&
      sender.username === renderer.username &&
      sender.password === renderer.password &&
      sender.host === renderer.host &&
      decodeURIComponent(sender.pathname) === decodeURIComponent(renderer.pathname) &&
      sender.search === renderer.search &&
      sender.hash === renderer.hash
    );
  } catch {
    return false;
  }
};

export const assertTrustedSender = (
  event: IpcMainInvokeEvent,
  rendererUrl: string,
): void => {
  const frame = event.senderFrame;

  if (
    frame === null ||
    frame.parent !== null ||
    !isTrustedRendererUrl(frame.url, rendererUrl)
  ) {
    throw new AppError(
      ErrorCode.unauthorized,
      'Источник IPC-запроса не разрешён.',
    );
  }
};
