import { describe, expect, it } from '@jest/globals';
import { compareIngestCursorPayloads } from './cursor.js';

describe('ingest cursor comparison', () => {
  const changedAt = '2026-04-09T08:00:00.000Z';

  it('sorts generated full-mirror replay listing keys by numeric sequence and offset', () => {
    expect(compareIngestCursorPayloads(
      { changedAt, listingKey: 'funda:full-mirror:2:3000' },
      { changedAt, listingKey: 'funda:full-mirror:10:11000' },
    )).toBeLessThan(0);

    expect(compareIngestCursorPayloads(
      { changedAt, listingKey: 'funda:full-mirror:2:3000' },
      { changedAt, listingKey: 'funda:full-mirror:2:11000' },
    )).toBeLessThan(0);
  });

  it('preserves raw lexical ordering for normal listing ids', () => {
    expect(compareIngestCursorPayloads(
      { changedAt, listingKey: 'funda-listing-10' },
      { changedAt, listingKey: 'funda-listing-2' },
    )).toBeLessThan(0);
  });
});
