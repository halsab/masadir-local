export interface IndexChangeSet {
  addedBookIds: string[];
  changedBookIds: string[];
  removedBookIds: string[];
  requiresRecovery: boolean;
}

// Этап C реализует этот порт, не меняя файловый контракт библиотеки.
export interface IndexService {
  applyLibraryChanges(changes: IndexChangeSet): Promise<void>;
}
