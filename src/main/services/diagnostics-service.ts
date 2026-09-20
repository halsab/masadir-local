import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ErrorCode, InvokeChannel } from '../../shared/contracts';

const MAX_LOG_SIZE = 5 * 1024 * 1024;
const LOG_FILE_COUNT = 3;

type DiagnosticEvent =
  | 'app-started'
  | 'ipc-request-failed'
  | 'library-reconcile-failed'
  | 'settings-load-failed';

interface DiagnosticFields {
  channel?: InvokeChannel;
  code?: ErrorCode;
}

export class DiagnosticsService {
  private readonly logFile: string;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(logDirectory: string) {
    this.logFile = path.join(logDirectory, 'masadir.log');
  }

  info(event: DiagnosticEvent, fields: DiagnosticFields = {}): Promise<void> {
    return this.enqueue('info', event, fields);
  }

  error(event: DiagnosticEvent, fields: DiagnosticFields = {}): Promise<void> {
    return this.enqueue('error', event, fields);
  }

  private enqueue(
    level: 'info' | 'error',
    event: DiagnosticEvent,
    fields: DiagnosticFields,
  ): Promise<void> {
    const line = `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    })}\n`;

    this.pendingWrite = this.pendingWrite
      .then(() => this.writeLine(line))
      .catch(() => undefined);

    return this.pendingWrite;
  }

  private async writeLine(line: string): Promise<void> {
    await mkdir(path.dirname(this.logFile), { recursive: true });

    const currentSize = await stat(this.logFile)
      .then((file) => file.size)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return 0;
        }
        throw error;
      });

    if (currentSize + Buffer.byteLength(line) > MAX_LOG_SIZE) {
      await this.rotate();
    }

    await appendFile(this.logFile, line, { encoding: 'utf8', mode: 0o600 });
  }

  private async rotate(): Promise<void> {
    const lastArchive = `${this.logFile}.${LOG_FILE_COUNT - 1}`;
    await rm(lastArchive, { force: true });

    for (let index = LOG_FILE_COUNT - 2; index >= 1; index -= 1) {
      await this.renameIfExists(
        `${this.logFile}.${index}`,
        `${this.logFile}.${index + 1}`,
      );
    }

    await this.renameIfExists(this.logFile, `${this.logFile}.1`);
  }

  private async renameIfExists(
    source: string,
    destination: string,
  ): Promise<void> {
    try {
      await rename(source, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
