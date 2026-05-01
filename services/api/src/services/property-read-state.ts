import { sql, type SQL } from 'drizzle-orm';
import { db, type DbTransaction } from '../db/index.js';

type SqlExecutor = {
  execute<T = unknown>(query: SQL): Promise<Iterable<T>>;
};

export type PropertyReadViewer =
  | { userId: string; sessionId?: never }
  | { userId?: never; sessionId: string };

type PropertyGroupLike = {
  propertyIds: string[];
};

function executorOrDb(executor?: SqlExecutor | DbTransaction): SqlExecutor {
  return (executor ?? db) as unknown as SqlExecutor;
}

function normalizeSessionId(sessionId: string | string[] | null | undefined): string | null {
  const raw = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  const normalized = raw?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function resolvePropertyReadViewer(
  userId: string | null | undefined,
  sessionId: string | string[] | null | undefined,
): PropertyReadViewer | null {
  if (userId) {
    return { userId };
  }

  const normalizedSessionId = normalizeSessionId(sessionId);
  return normalizedSessionId ? { sessionId: normalizedSessionId } : null;
}

export function getPropertyReadViewerScope(viewer: PropertyReadViewer): string {
  return 'userId' in viewer ? `user:${viewer.userId}` : `session:${viewer.sessionId}`;
}

function dedupePropertyIds(propertyIds: readonly string[]): string[] {
  return [...new Set(propertyIds.filter((propertyId) => propertyId.length > 0))];
}

function propertyIdValues(propertyIds: readonly string[]): SQL {
  return sql.join(propertyIds.map((propertyId) => sql`(${propertyId}::uuid)`), sql`, `);
}

function readStateIdentityPredicate(viewer: PropertyReadViewer): SQL {
  if ('userId' in viewer) {
    return sql`prs.user_id = ${viewer.userId} AND prs.session_id IS NULL`;
  }

  return sql`prs.session_id = ${viewer.sessionId} AND prs.user_id IS NULL`;
}

export async function ensurePropertyChangeState(
  propertyId: string,
  executor?: SqlExecutor | DbTransaction,
): Promise<{ propertyId: string; changeVersion: number; lastChangedAt: Date }> {
  const rows = await executorOrDb(executor).execute<{
    property_id: string;
    change_version: number;
    last_changed_at: Date;
  }>(sql`
    WITH inserted AS (
      INSERT INTO property_change_state (property_id)
      VALUES (${propertyId})
      ON CONFLICT (property_id) DO NOTHING
      RETURNING property_id, change_version, last_changed_at
    )
    SELECT property_id, change_version, last_changed_at
    FROM inserted
    UNION ALL
    SELECT property_id, change_version, last_changed_at
    FROM property_change_state
    WHERE property_id = ${propertyId}
    LIMIT 1
  `);

  const row = Array.from(rows)[0];
  if (!row) {
    throw new Error(`Property change state could not be created for ${propertyId}`);
  }

  return {
    propertyId: row.property_id,
    changeVersion: Number(row.change_version),
    lastChangedAt: row.last_changed_at,
  };
}

export async function markPropertyRead(
  propertyId: string,
  viewer: PropertyReadViewer,
  executor?: SqlExecutor | DbTransaction,
): Promise<void> {
  const current = await ensurePropertyChangeState(propertyId, executor);
  const target = executorOrDb(executor);

  if ('userId' in viewer) {
    await target.execute(sql`
      INSERT INTO property_read_state (
        property_id,
        user_id,
        session_id,
        seen_change_version,
        seen_at
      )
      VALUES (${propertyId}, ${viewer.userId}, NULL, ${current.changeVersion}, NOW())
      ON CONFLICT (user_id, property_id) WHERE user_id IS NOT NULL AND session_id IS NULL
      DO UPDATE SET
        seen_change_version = GREATEST(
          property_read_state.seen_change_version,
          EXCLUDED.seen_change_version
        ),
        seen_at = NOW()
    `);
    return;
  }

  await target.execute(sql`
    INSERT INTO property_read_state (
      property_id,
      user_id,
      session_id,
      seen_change_version,
      seen_at
    )
    VALUES (${propertyId}, NULL, ${viewer.sessionId}, ${current.changeVersion}, NOW())
    ON CONFLICT (session_id, property_id) WHERE session_id IS NOT NULL AND user_id IS NULL
    DO UPDATE SET
      seen_change_version = GREATEST(
        property_read_state.seen_change_version,
        EXCLUDED.seen_change_version
      ),
      seen_at = NOW()
  `);
}

export async function advancePropertyChangeVersion(
  propertyIds: readonly string[] | string,
  executor?: SqlExecutor | DbTransaction,
): Promise<void> {
  const ids = dedupePropertyIds(Array.isArray(propertyIds) ? propertyIds : [propertyIds]);
  if (ids.length === 0) {
    return;
  }

  await executorOrDb(executor).execute(sql`
    WITH changed(property_id) AS (
      VALUES ${propertyIdValues(ids)}
    )
    INSERT INTO property_change_state (property_id, change_version, last_changed_at)
    SELECT property_id, 1, NOW()
    FROM changed
    ON CONFLICT (property_id) DO UPDATE SET
      change_version = property_change_state.change_version + 1,
      last_changed_at = EXCLUDED.last_changed_at
  `);
}

export async function getReadPropertyIdSet(
  propertyIds: readonly string[],
  viewer: PropertyReadViewer | null,
  executor?: SqlExecutor | DbTransaction,
): Promise<Set<string>> {
  const ids = dedupePropertyIds(propertyIds);
  if (!viewer || ids.length === 0) {
    return new Set();
  }

  const rows = await executorOrDb(executor).execute<{ property_id: string }>(sql`
    WITH requested(property_id) AS (
      VALUES ${propertyIdValues(ids)}
    )
    SELECT requested.property_id
    FROM requested
    LEFT JOIN property_change_state pcs ON pcs.property_id = requested.property_id
    LEFT JOIN property_read_state prs
      ON prs.property_id = requested.property_id
     AND ${readStateIdentityPredicate(viewer)}
    WHERE prs.seen_change_version >= COALESCE(pcs.change_version, 0)
  `);

  return new Set(Array.from(rows).map((row) => row.property_id));
}

export async function isPropertyReadForViewer(
  propertyId: string,
  viewer: PropertyReadViewer | null,
  executor?: SqlExecutor | DbTransaction,
): Promise<boolean> {
  const readIds = await getReadPropertyIdSet([propertyId], viewer, executor);
  return readIds.has(propertyId);
}

export async function hasCurrentReadStateForViewer(
  viewer: PropertyReadViewer,
  executor?: SqlExecutor | DbTransaction,
): Promise<boolean> {
  const rows = await executorOrDb(executor).execute<{ has_read_state: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM property_read_state prs
      LEFT JOIN property_change_state pcs ON pcs.property_id = prs.property_id
      WHERE ${readStateIdentityPredicate(viewer)}
        AND prs.seen_change_version >= COALESCE(pcs.change_version, 0)
      LIMIT 1
    ) AS has_read_state
  `);

  return Array.from(rows)[0]?.has_read_state === true;
}

export async function filterReadCanonicalGroups<TGroup extends PropertyGroupLike>(
  groups: readonly TGroup[],
  viewer: PropertyReadViewer,
  executor?: SqlExecutor | DbTransaction,
): Promise<TGroup[]> {
  const readIds = await getReadPropertyIdSet(
    groups.flatMap((group) => group.propertyIds),
    viewer,
    executor,
  );

  return groups.filter((group) =>
    group.propertyIds.length > 0 && group.propertyIds.every((propertyId) => readIds.has(propertyId))
  );
}
