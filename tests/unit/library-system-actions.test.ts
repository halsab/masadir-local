import { describe, expect, it, vi } from 'vitest';

import { LibraryService } from '../../src/main/library/library-service';
import { emptyStoredLibraryState } from '../../src/main/library/library-types';

describe('library system actions', () => {
  it('opens only the current canonical library root', async () => {
    const openPath = vi.fn(async () => '');
    const library = new LibraryService({
      dialogs: {},
      forbiddenRoots: [],
      indexService: {},
      settings: { schemaVersion: 1, libraryRoot: null },
      settingsService: {},
      shell: { openPath, trashItem: async () => undefined },
      stateStore: {},
    } as unknown as ConstructorParameters<typeof LibraryService>[0]);
    library.setLoadedState('/library/current', emptyStoredLibraryState());

    await library.openFolder();

    expect(openPath).toHaveBeenCalledExactlyOnceWith('/library/current');
  });
});
