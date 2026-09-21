import { describe, expect, it } from 'vitest';

import { isTrustedRendererUrl } from '../../src/main/app/trusted-sender';

describe('isTrustedRendererUrl', () => {
  it('accepts equivalent packaged file URLs with encoded Unicode', () => {
    expect(
      isTrustedRendererUrl(
        'file:///Applications/Mas%C4%81dir.app/renderer/index.html',
        'file:///Applications/Masādir.app/renderer/index.html',
      ),
    ).toBe(true);
  });

  it('rejects a different path or web origin', () => {
    expect(
      isTrustedRendererUrl(
        'file:///Applications/Other.app/renderer/index.html',
        'file:///Applications/Masādir.app/renderer/index.html',
      ),
    ).toBe(false);
    expect(
      isTrustedRendererUrl(
        'https://example.test/main_window/index.html',
        'http://localhost:3000/main_window/index.html',
      ),
    ).toBe(false);
  });
});
