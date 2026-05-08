import { describe, expect, it } from '@jest/globals';
import { formatDate } from './reconcile-funda-f1dd-stale-observations.js';

describe('reconcile-funda-f1dd-stale-observations date formatting', () => {
  it('formats Date, string, null, and number values returned by raw DB queries', () => {
    expect(formatDate(new Date('2026-05-08T17:12:34.000Z'))).toBe('2026-05-08T17:12:34.000Z');
    expect(formatDate('2026-05-08T17:12:34.000Z')).toBe('2026-05-08T17:12:34.000Z');
    expect(formatDate(null)).toBe('null');
    expect(formatDate(1_778_261_554_000)).toBe('2026-05-08T17:32:34.000Z');
  });

  it('does not throw for unexpected non-date values', () => {
    expect(formatDate({ raw: '2026-05-08T17:12:34.000Z' })).toBe('[object Object]');
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});
