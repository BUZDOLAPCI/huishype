import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../db/schema.js';
import { parseReconciliationOptions } from '../../scripts/reconcile-source-identities.js';
import { reconcileSourceIdentityCheckpoint, SOURCE_IDENTITY_RECONCILIATION_VERSION } from '../../services/ingest/identity-reconciliation-checkpoint.js';

const schemaName = `checkpoint_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(process.env.DATABASE_URL!);
databaseUrl.searchParams.set('search_path', schemaName);
const administration = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const client = postgres(databaseUrl.href, { max: 2, onnotice: () => {} });
const database = drizzle(client, { schema });
const checkpoint = schema.sourceIdentityReconciliationCheckpoints;
const executeOnce = { execute: true, once: true };
const report = {
  rowsBefore: 2, canonicalRowsBefore: 2, legacyRowsBefore: 0, identityGroups: 1,
  duplicateGroups: 1, quarantinedGroups: 0, canonicalDuplicatesSuppressed: 1, legacyDuplicatesRecorded: 0,
  rowsAfter: 2, canonicalRowsAfter: 2, legacyRowsAfter: 0,
  profile: { graphParentBytes: 8, graphEdgeBatchLimit: 5000, edgesRead: 1, maximumComponentRows: 2, graphPreparationMs: 1,
    fastPathGroups: 0, fastPathLegacyRows: 0, reconciliationMs: 2 },
};
function source() { return `test-${randomUUID()}`; }

beforeAll(async () => {
  await administration`CREATE SCHEMA ${administration(schemaName)}`;
  await client.unsafe(await readFile(new URL('../../../drizzle/0065_source_identity_reconciliation_checkpoints.sql', import.meta.url), 'utf8'));
  await client`CREATE TABLE effects (source_name text PRIMARY KEY)`;
});
afterAll(async () => {
  await client.end();
  await administration`DROP SCHEMA IF EXISTS ${administration(schemaName)} CASCADE`;
  await administration.end();
});

async function stored(sourceName: string) {
  return database.select().from(checkpoint).where(eq(checkpoint.sourceName, sourceName));
}
async function runCli(args: string[]) {
  const script = fileURLToPath(new URL('../../scripts/reconcile-source-identities.ts', import.meta.url));
  return new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, ['--import', 'tsx', script, ...args], {
      // This deliberately excludes every API/worker secret, Redis URL and auth setting.
      env: { DATABASE_URL: databaseUrl.href, NODE_ENV: 'production', PATH: process.env.PATH }, timeout: 15_000,
    }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout, stderr }));
  });
}

describe('durable source identity reconciliation checkpoint', () => {
  it('records bounded completion atomically and skips graph work on subsequent startup', async () => {
    const sourceName = source();
    let calls = 0;
    const reconcile = async () => { calls += 1; return { ...report, conflicts: [{ aliases: 'x'.repeat(10000) }] }; };
    const first = await database.transaction(tx => reconcileSourceIdentityCheckpoint(tx, sourceName, executeOnce, reconcile));
    expect(first).toMatchObject({ status: 'completed', reconciliationVersion: SOURCE_IDENTITY_RECONCILIATION_VERSION, report });
    expect(JSON.stringify(first).length).toBeLessThan(4096);
    const second = await database.transaction(tx => reconcileSourceIdentityCheckpoint(tx, sourceName, executeOnce, reconcile));
    expect(second).toEqual({ ...first, status: 'already_completed' });
    expect(calls).toBe(1);
    expect(await stored(sourceName)).toHaveLength(1);
  });

  it('rolls back reconciliation side effects and leaves no checkpoint on failure', async () => {
    const sourceName = source();
    await expect(database.transaction(tx => reconcileSourceIdentityCheckpoint(tx, sourceName, executeOnce, async current => {
      await current.execute(sql`INSERT INTO effects(source_name) VALUES (${sourceName})`);
      throw new Error('reconciliation failed');
    }))).rejects.toThrow('reconciliation failed');
    expect(await stored(sourceName)).toHaveLength(0);
    expect(await client`SELECT * FROM effects WHERE source_name = ${sourceName}`).toHaveLength(0);
  });

  it('serializes concurrent startup transactions before checking completion', async () => {
    const sourceName = source();
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    let calls = 0;
    const first = database.transaction(tx => reconcileSourceIdentityCheckpoint(tx, sourceName, executeOnce, async () => {
      calls += 1; started(); await held; return report;
    }));
    await entered;
    let secondStarted!: (pid: number) => void;
    const enteredSecond = new Promise<number>(resolve => { secondStarted = resolve; });
    const second = database.transaction(async tx => {
      const [connection] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      secondStarted(connection!.pid);
      return reconcileSourceIdentityCheckpoint(tx, sourceName, executeOnce, async () => { calls += 1; return report; });
    });
    const secondPid = await enteredSecond;
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        const [lock] = await administration`SELECT EXISTS (
          SELECT 1 FROM pg_locks WHERE pid = ${secondPid} AND locktype = 'advisory' AND NOT granted
        ) AS waiting`;
        waiting = lock!.waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      expect(calls).toBe(1);
    } finally {
      release();
      await Promise.all([first, second]);
    }
    expect((await Promise.all([first, second])).map(result => result.status)).toEqual(['completed', 'already_completed']);
    expect(calls).toBe(1);
  });

  it('runs a new algorithm version independently and supports explicit manual reruns', async () => {
    const sourceName = source();
    await database.insert(checkpoint).values({ sourceName, reconciliationVersion: 'previous-version', reportJson: report });
    let calls = 0;
    const reconcile = async () => { calls += 1; return { ...report, rowsBefore: calls }; };
    await database.transaction(tx => reconcileSourceIdentityCheckpoint(tx, sourceName, executeOnce, reconcile));
    await database.transaction(tx => reconcileSourceIdentityCheckpoint(tx, sourceName, { execute: true, once: false }, reconcile));
    expect(calls).toBe(2);
    expect(await stored(sourceName)).toHaveLength(2);
    const [current] = await database.select().from(checkpoint).where(and(eq(checkpoint.sourceName, sourceName),
      eq(checkpoint.reconciliationVersion, SOURCE_IDENTITY_RECONCILIATION_VERSION)));
    expect(current!.reportJson.rowsBefore).toBe(2);
  });

  it('keeps the default dry-run read-only and rejects once without execute', async () => {
    expect(parseReconciliationOptions(['--source', 'funda'])).toEqual({ sourceName: 'funda', execute: false, once: false });
    expect(() => parseReconciliationOptions(['--source', 'funda', '--once'])).toThrow('--once requires --execute');
    const sourceName = source();
    const result = await database.transaction(tx => reconcileSourceIdentityCheckpoint(tx, sourceName, { execute: false, once: false },
      async (_tx, _source, options) => { expect(options.dryRun).toBe(true); return report; }));
    expect(result.status).toBe('dry_run');
    expect(result.completedAt).toBeNull();
    expect(await stored(sourceName)).toHaveLength(0);
  });

  it('runs the startup CLI with DATABASE_URL alone and fails without marking unfinished work', async () => {
    await database.insert(checkpoint).values({ sourceName: 'funda', reconciliationVersion: SOURCE_IDENTITY_RECONCILIATION_VERSION, reportJson: report });
    const complete = await runCli(['--source', 'funda', '--execute', '--once']);
    expect(complete).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(complete.stdout)).toMatchObject({ status: 'already_completed', sourceName: 'funda', report });
    // This isolated schema intentionally has no listing tables: actual work must fail closed.
    const failed = await runCli(['--source', 'pararius', '--execute', '--once']);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('IDENTITY_RECONCILIATION_FAILED');
    expect(failed.stderr).not.toContain('Missing required');
    expect(await stored('pararius')).toHaveLength(0);
  }, 20_000);
});
