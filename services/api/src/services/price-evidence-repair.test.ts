import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const calculateKarma = jest.fn<() => Promise<{ karma: number; internalKarma: number }>>();
const invalidate = jest.fn<() => Promise<void>>();
const watermark = jest.fn<() => Promise<void>>();
jest.unstable_mockModule('./karma.js', () => ({ calculateKarmaForUser: calculateKarma }));
jest.unstable_mockModule('./property-read-state.js', () => ({ advancePropertyChangeVersion: invalidate }));
jest.unstable_mockModule('./property-tile-pyramid.js', () => ({ advancePropertyTilePyramidSourceWatermark: watermark }));
const { runPriceEvidenceRepair } = await import('./price-evidence-repair.js');

const propertyId = '00000000-0000-0000-0000-000000000001';
const otherPropertyId = '00000000-0000-0000-0000-000000000002';
const userId = '00000000-0000-0000-0000-000000000003';
const dialect = new PgDialect();

function fixture(options: { acquired?: boolean; empty?: boolean; karma?: number } = {}) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let completed = false;
  const tx = {
    execute: async (query: SQL) => {
      const rendered = dialect.sqlToQuery(query);
      queries.push(rendered);
      if (rendered.sql.includes('pg_try_advisory_xact_lock')) return [{ acquired: options.acquired ?? true }];
      if (rendered.sql.includes('SELECT property_id FROM price_evidence_repair_queue')) {
        return options.empty || completed ? [] : [{ property_id: propertyId }];
      }
      if (rendered.sql.includes('SELECT u.id')) return [{ id: userId, karma: options.karma ?? 50, internal_karma: options.karma ?? 50 }];
      if (rendered.sql.includes('SELECT DISTINCT property_id')) return [{ property_id: otherPropertyId }, { property_id: propertyId }];
      if (rendered.sql.includes('UPDATE price_evidence_repair_queue')) completed = true;
      return [];
    },
  };
  const database = {
    transaction: async (fn: (transaction: typeof tx) => Promise<unknown>) => {
      const before = completed;
      try { return await fn(tx); } catch (error) { completed = before; throw error; }
    },
  } as unknown as NonNullable<Parameters<typeof runPriceEvidenceRepair>[1]>;
  return { database, tx, queries, completed: () => completed };
}

beforeEach(() => {
  jest.clearAllMocks();
  calculateKarma.mockResolvedValue({ karma: 0, internalKarma: 0 });
  invalidate.mockResolvedValue(undefined);
  watermark.mockResolvedValue(undefined);
});

describe('price evidence derived repair', () => {
  it('revokes old karma and invalidates all properties affected by its FMV weight', async () => {
    const f = fixture();
    await expect(runPriceEvidenceRepair(100, f.database)).resolves.toEqual({
      repairedProperties: 1, recalculatedUsers: 1, changedUsers: 1, invalidatedProperties: 2,
    });
    expect(calculateKarma).toHaveBeenCalledWith(userId, f.tx);
    expect(invalidate).toHaveBeenCalledWith([propertyId, otherPropertyId], f.tx);
    expect(watermark).toHaveBeenCalledWith(['listing_facts', 'social_inputs'], f.tx);
    expect(f.completed()).toBe(true);
    expect(f.queries.find((query) => query.sql.includes('UPDATE users'))?.params).toEqual([0, 0, userId]);
  });

  it('does not repair completed properties or recalculate their users again', async () => {
    const f = fixture();
    await runPriceEvidenceRepair(100, f.database);
    await expect(runPriceEvidenceRepair(100, f.database)).resolves.toEqual({
      repairedProperties: 0, recalculatedUsers: 0, changedUsers: 0, invalidatedProperties: 0,
    });
    expect(calculateKarma).toHaveBeenCalledTimes(1);
  });

  it('leaves the queue pending when derived invalidation fails', async () => {
    const f = fixture();
    watermark.mockRejectedValueOnce(new Error('watermark failed'));
    await expect(runPriceEvidenceRepair(100, f.database)).rejects.toThrow('watermark failed');
    expect(f.completed()).toBe(false);
    await expect(runPriceEvidenceRepair(100, f.database)).resolves.toMatchObject({ repairedProperties: 1 });
  });

  it('does not duplicate work when a concurrent repair holds the lock', async () => {
    const f = fixture({ acquired: false });
    await expect(runPriceEvidenceRepair(100, f.database)).resolves.toMatchObject({ repairedProperties: 0 });
    expect(f.queries).toHaveLength(1);
    expect(calculateKarma).not.toHaveBeenCalled();
  });

  it('still invalidates corrected sale projections when karma is unchanged', async () => {
    const f = fixture({ karma: 0 });
    await expect(runPriceEvidenceRepair(100, f.database)).resolves.toMatchObject({ changedUsers: 0, invalidatedProperties: 1 });
    expect(invalidate).toHaveBeenCalledWith([propertyId], f.tx);
  });

  it('rejects unbounded or invalid batch sizes', async () => {
    const f = fixture();
    for (const limit of [0, -1, 10_001, 1.5, Number.NaN]) {
      await expect(runPriceEvidenceRepair(limit, f.database)).rejects.toThrow('repair limit');
    }
    expect(f.queries).toHaveLength(0);
  });
});
