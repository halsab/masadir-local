import { describe, expect, it } from 'vitest';

import { normalizeQuery } from '../../src/main/search/query-normalizer';

describe('normalizeQuery', () => {
  it('trims, removes control characters and collapses whitespace', () => {
    expect(normalizeQuery(' \tلغة\u0000\n  عربية\u0085 ')).toBe('لغة عربية');
  });

  it('replaces wildcard, bracket and phrase syntax with spaces', () => {
    expect(normalizeQuery('one*[two]? "three"')).toBe('one two three');
  });

  it('limits the result to 256 Unicode code points', () => {
    const normalized = normalizeQuery(`${'😀'.repeat(255)}ab`);
    expect(Array.from(normalized)).toHaveLength(256);
    expect(normalized.endsWith('a')).toBe(true);
  });

  it('does not apply language-specific normalization', () => {
    expect(normalizeQuery('إِسْلام  Islam')).toBe('إِسْلام Islam');
  });
});
