import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  db,
  officialValuationSourceStates,
  properties,
  propertyOfficialValuationHydrationJobs,
  propertyOfficialValuations,
  type DbTransaction,
} from '../../db/index.js';
import {
  createMaintenanceRefreshRequest,
  type MaintenanceRefreshRequestRecord,
} from '../ingest/store.js';
import { advancePropertyChangeVersion } from '../property-read-state.js';
import { advancePropertyTilePyramidSourceWatermark } from '../property-tile-pyramid.js';
import type { ClientObservedOfficialValuation, OfficialValuationSource } from './contracts.js';
import { getFailedHydrationRetryAt, getOfficialValuationSourceConfig } from './registry.js';
import type { OfficialValuationSourceProperty, OfficialValuationSourceResult } from './source-client.js';

type HydrationJobState = 'queued' | 'running' | 'succeeded' | 'retryable' | 'failed' | 'cooldown';

type JobRow = typeof propertyOfficialValuationHydrationJobs.$inferSelect;

const SOURCE_IN_FLIGHT_LEASE_MS = 10 * 60_000;
const SOURCE_CONCURRENCY_RETRY_MS = 5_000;

export type HydrationRequestResult = {
  status: 'unsupported' | 'already_cached' | 'accepted' | 'queued' | 'pending';
  propertyId: string;
  source: OfficialValuationSource;
  valuationYear: number;
  cachedValuation: number | null;
  cachedValuationYear: number | null;
  cachedVerified: boolean;
  job: {
    id: string;
    state: HydrationJobState;
    nextAttemptAt: string | null;
  } | null;
  dispatchJob: {
    jobId: string;
    propertyId: string;
    source: OfficialValuationSource;
    valuationYear: number;
  } | null;
  maintenanceRequest: MaintenanceRefreshRequestRecord | null;
};

export type ClaimedOfficialValuationHydrationJob = {
  id: string;
  source: OfficialValuationSource;
  valuationYear: number;
  attemptCount: number;
  property: OfficialValuationSourceProperty;
};

export type SourceReservation =
  | { allowed: true }
  | { allowed: false; reason: string; nextAttemptAt: Date };

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toJsonbParameter(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(
    value && typeof value === 'object' && !Array.isArray(value) ? value : { value },
  );
}

async function refreshPropertyOfficialValuationCache(
  tx: DbTransaction,
  propertyId: string,
): Promise<void> {
  await tx.execute(sql`
    WITH ranked AS (
      SELECT
        v.valuation,
        v.valuation_year,
        v.verified
      FROM property_official_valuations v
      WHERE v.property_id = ${propertyId}
      ORDER BY
        v.valuation_year DESC,
        v.verified DESC,
        CASE v.source
          WHEN 'woz' THEN 1
          ELSE 100
        END,
        v.fetched_at DESC
      LIMIT 1
    )
    UPDATE properties p
    SET
      official_valuation = ranked.valuation,
      official_valuation_year = ranked.valuation_year,
      official_valuation_verified = ranked.verified,
      updated_at = now()
    FROM ranked
    WHERE p.id = ${propertyId}
  `);
}

async function createOfficialValuationMaintenanceRefreshRequest(
  tx: DbTransaction,
  input: {
    propertyId: string;
    source: OfficialValuationSource;
    valuation: number | null;
    valuationYear: number;
    idempotencyKey: string;
    origin: 'client_observed' | 'server_verified';
  },
): Promise<MaintenanceRefreshRequestRecord> {
  return createMaintenanceRefreshRequest(tx, {
    sourceName: `official-valuation-${input.source}`,
    requestedBy: 'official-valuation',
    idempotencyKey: input.idempotencyKey,
    payload: {
      propertyId: input.propertyId,
      source: input.source,
      valuation: input.valuation,
      valuationYear: input.valuationYear,
      origin: input.origin,
    },
  });
}

async function getPropertyForHydration(
  tx: DbTransaction,
  propertyId: string,
): Promise<(typeof properties.$inferSelect) | null> {
  const rows = await tx
    .select()
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);

  return rows[0] ?? null;
}

async function getCurrentValuationRow(
  tx: DbTransaction,
  propertyId: string,
  source: OfficialValuationSource,
  valuationYear: number,
): Promise<(typeof propertyOfficialValuations.$inferSelect) | null> {
  const rows = await tx
    .select()
    .from(propertyOfficialValuations)
    .where(
      and(
        eq(propertyOfficialValuations.propertyId, propertyId),
        eq(propertyOfficialValuations.source, source),
        eq(propertyOfficialValuations.valuationYear, valuationYear),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function upsertClientObservedValuation(
  tx: DbTransaction,
  input: {
    propertyId: string;
    source: OfficialValuationSource;
    observed: ClientObservedOfficialValuation;
    submittedByUserId: string | null;
  },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO property_official_valuations (
      property_id,
      valuation,
      valuation_year,
      reference_date,
      source,
      source_record_id,
      source_dataset_version,
      source_url,
      raw_payload,
      verified,
      verified_at,
      origin,
      submitted_by_user_id,
      client_runtime,
      source_request_fingerprint,
      fetched_at
    )
    VALUES (
      ${input.propertyId},
      ${input.observed.valuation},
      ${input.observed.valuationYear},
      ${input.observed.referenceDate ?? null},
      ${input.source},
      ${input.observed.sourceRecordId ?? null},
      ${input.observed.sourceDatasetVersion ?? null},
      ${input.observed.sourceUrl ?? null},
      ${toJsonbParameter(input.observed.rawPayload)}::jsonb,
      false,
      NULL,
      'client_observed',
      ${input.submittedByUserId},
      ${input.observed.clientRuntime ?? null},
      ${input.observed.sourceRequestFingerprint ?? null},
      now()
    )
    ON CONFLICT (property_id, valuation_year, source)
    DO UPDATE SET
      valuation = EXCLUDED.valuation,
      reference_date = EXCLUDED.reference_date,
      source_record_id = EXCLUDED.source_record_id,
      source_dataset_version = EXCLUDED.source_dataset_version,
      source_url = EXCLUDED.source_url,
      raw_payload = EXCLUDED.raw_payload,
      origin = 'client_observed',
      submitted_by_user_id = EXCLUDED.submitted_by_user_id,
      client_runtime = EXCLUDED.client_runtime,
      source_request_fingerprint = EXCLUDED.source_request_fingerprint,
      fetched_at = EXCLUDED.fetched_at,
      updated_at = now()
    WHERE property_official_valuations.verified = false
  `);
}

async function upsertHydrationJob(
  tx: DbTransaction,
  input: {
    propertyId: string;
    source: OfficialValuationSource;
    valuationYear: number;
    shouldRefreshSucceeded: boolean;
  },
): Promise<JobRow> {
  const existingRows = await tx
    .select()
    .from(propertyOfficialValuationHydrationJobs)
    .where(
      and(
        eq(propertyOfficialValuationHydrationJobs.propertyId, input.propertyId),
        eq(propertyOfficialValuationHydrationJobs.source, input.source),
        eq(propertyOfficialValuationHydrationJobs.valuationYear, input.valuationYear),
      ),
    )
    .limit(1);
  const existing = existingRows[0];

  if (!existing) {
    const rows = await tx
      .insert(propertyOfficialValuationHydrationJobs)
      .values({
        propertyId: input.propertyId,
        source: input.source,
        valuationYear: input.valuationYear,
        state: 'queued',
        nextAttemptAt: new Date(),
      })
      .returning();
    return rows[0];
  }

  const state = existing.state as HydrationJobState;
  if (state === 'running' || state === 'queued' || state === 'retryable') {
    return existing;
  }

  if (state === 'succeeded' && !input.shouldRefreshSucceeded) {
    return existing;
  }

  const rows = await tx
    .update(propertyOfficialValuationHydrationJobs)
    .set({
      state: 'queued',
      nextAttemptAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(propertyOfficialValuationHydrationJobs.id, existing.id))
    .returning();

  return rows[0];
}

function shouldDispatch(job: JobRow): boolean {
  const state = job.state as HydrationJobState;
  return (
    (state === 'queued' || state === 'retryable') &&
    (job.nextAttemptAt == null || job.nextAttemptAt.getTime() <= Date.now())
  );
}

export async function acceptOfficialValuationHydrationRequest(input: {
  propertyId: string;
  source: OfficialValuationSource;
  observed: ClientObservedOfficialValuation | null;
  submittedByUserId: string | null;
}): Promise<HydrationRequestResult | null> {
  return db.transaction(async (tx) => {
    const property = await getPropertyForHydration(tx, input.propertyId);
    if (!property) {
      return null;
    }

    const config = getOfficialValuationSourceConfig(input.source);
    if (!config.countries.includes(property.countryCode)) {
      return {
        status: 'unsupported',
        propertyId: input.propertyId,
        source: input.source,
        valuationYear: config.expectedValuationYear,
        cachedValuation: property.officialValuation ?? null,
        cachedValuationYear: property.officialValuationYear ?? null,
        cachedVerified: property.officialValuationVerified,
        job: null,
        dispatchJob: null,
        maintenanceRequest: null,
      };
    }

    const valuationYear = input.observed?.valuationYear ?? config.expectedValuationYear;
    const existing = await getCurrentValuationRow(tx, input.propertyId, input.source, valuationYear);
    const recentSuccessCutoff = new Date(Date.now() - config.successfulHydrationCooldownMs);
    const shouldRefreshSucceeded =
      !existing?.verified ||
      existing.fetchedAt == null ||
      existing.fetchedAt.getTime() < recentSuccessCutoff.getTime();
    let cachedProperty = property;
    let maintenanceRequest: MaintenanceRefreshRequestRecord | null = null;

    if (input.observed) {
      await upsertClientObservedValuation(tx, {
        propertyId: input.propertyId,
        source: input.source,
        observed: input.observed,
        submittedByUserId: input.submittedByUserId,
      });
      await refreshPropertyOfficialValuationCache(tx, input.propertyId);
      await advancePropertyChangeVersion(input.propertyId, tx);
      await advancePropertyTilePyramidSourceWatermark(['official_valuations'], tx);
      cachedProperty = (await getPropertyForHydration(tx, input.propertyId)) ?? property;
      maintenanceRequest = await createOfficialValuationMaintenanceRefreshRequest(tx, {
        propertyId: input.propertyId,
        source: input.source,
        valuation: cachedProperty.officialValuation ?? null,
        valuationYear,
        origin: 'client_observed',
        idempotencyKey: `official-valuation:${input.propertyId}:${input.source}:${valuationYear}:${randomUUID()}`,
      });
    }

    const job = await upsertHydrationJob(tx, {
      propertyId: input.propertyId,
      source: input.source,
      valuationYear,
      shouldRefreshSucceeded,
    });

    const dispatch = shouldDispatch(job);
    const cachedValuation = cachedProperty.officialValuation ?? null;
    const cachedValuationYear = cachedProperty.officialValuationYear ?? null;
    const cachedVerified = cachedProperty.officialValuationVerified;

    return {
      status:
        existing?.verified && !shouldRefreshSucceeded
          ? 'already_cached'
          : input.observed
            ? 'accepted'
            : dispatch
              ? 'queued'
              : 'pending',
      propertyId: input.propertyId,
      source: input.source,
      valuationYear,
      cachedValuation,
      cachedValuationYear,
      cachedVerified,
      job: {
        id: job.id,
        state: job.state as HydrationJobState,
        nextAttemptAt: toIso(job.nextAttemptAt),
      },
      dispatchJob: dispatch
        ? {
            jobId: job.id,
            propertyId: input.propertyId,
            source: input.source,
            valuationYear,
          }
        : null,
      maintenanceRequest,
    };
  });
}

export async function collectDueOfficialValuationHydrationJobs(limit = 100): Promise<JobRow[]> {
  const rows = await db
    .select()
    .from(propertyOfficialValuationHydrationJobs)
    .where(
      and(
        inArray(propertyOfficialValuationHydrationJobs.state, ['queued', 'retryable', 'cooldown']),
        sql`${propertyOfficialValuationHydrationJobs.nextAttemptAt} IS NULL OR ${propertyOfficialValuationHydrationJobs.nextAttemptAt} <= now()`,
      ),
    )
    .limit(limit);

  return rows;
}

export async function markOfficialValuationHydrationJobQueued(jobId: string): Promise<void> {
  await db
    .update(propertyOfficialValuationHydrationJobs)
    .set({ state: 'queued', updatedAt: new Date() })
    .where(
      and(
        eq(propertyOfficialValuationHydrationJobs.id, jobId),
        inArray(propertyOfficialValuationHydrationJobs.state, ['retryable', 'cooldown']),
      ),
    );
}

export async function claimOfficialValuationHydrationJob(
  jobId: string,
): Promise<ClaimedOfficialValuationHydrationJob | null> {
  return db.transaction(async (tx) => {
    const jobRows = await tx
      .select()
      .from(propertyOfficialValuationHydrationJobs)
      .where(
        and(
          eq(propertyOfficialValuationHydrationJobs.id, jobId),
          inArray(propertyOfficialValuationHydrationJobs.state, ['queued', 'retryable']),
          sql`${propertyOfficialValuationHydrationJobs.nextAttemptAt} IS NULL OR ${propertyOfficialValuationHydrationJobs.nextAttemptAt} <= now()`,
        ),
      )
      .limit(1);
    const job = jobRows[0];
    if (!job) {
      return null;
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${job.source}))`);

    const updatedRows = await tx
      .update(propertyOfficialValuationHydrationJobs)
      .set({
        state: 'running',
        attemptCount: sql<number>`${propertyOfficialValuationHydrationJobs.attemptCount} + 1`,
        lastAttemptAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(propertyOfficialValuationHydrationJobs.id, jobId),
          inArray(propertyOfficialValuationHydrationJobs.state, ['queued', 'retryable']),
        ),
      )
      .returning();

    const claimed = updatedRows[0];
    if (!claimed) {
      return null;
    }

    const property = await getPropertyForHydration(tx, claimed.propertyId);
    if (!property) {
      return null;
    }

    return {
      id: claimed.id,
      source: claimed.source as OfficialValuationSource,
      valuationYear: claimed.valuationYear,
      attemptCount: claimed.attemptCount,
      property: {
        id: property.id,
        countryCode: property.countryCode,
        nationalId: property.nationalId,
        street: property.street,
        postalCode: property.postalCode,
        houseNumber: property.houseNumber,
        houseNumberAddition: property.houseNumberAddition,
        city: property.city,
      },
    };
  });
}

export async function reserveOfficialValuationSourceRequest(
  source: OfficialValuationSource,
): Promise<SourceReservation> {
  const config = getOfficialValuationSourceConfig(source);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${source}))`);
    const now = new Date();
    const minuteResetAt = new Date(now.getTime() + 60_000);
    const dayResetAt = new Date(now.getTime() + 24 * 60 * 60_000);

    await tx
      .insert(officialValuationSourceStates)
      .values({
        source,
        minuteWindowResetAt: minuteResetAt,
        dayWindowResetAt: dayResetAt,
      })
      .onConflictDoNothing();

    const stateRows = await tx
      .select()
      .from(officialValuationSourceStates)
      .where(eq(officialValuationSourceStates.source, source))
      .limit(1);
    const state = stateRows[0];

    const halfOpenAt = state.circuitHalfOpenAt;
    if (state.state === 'open' && halfOpenAt && halfOpenAt.getTime() > now.getTime()) {
      return { allowed: false, reason: 'source_circuit_open', nextAttemptAt: halfOpenAt };
    }

    const minuteExpired =
      !state.minuteWindowResetAt || state.minuteWindowResetAt.getTime() <= now.getTime();
    const dayExpired = !state.dayWindowResetAt || state.dayWindowResetAt.getTime() <= now.getTime();
    const minuteCount = minuteExpired ? 0 : state.requestsInCurrentMinute;
    const dayCount = dayExpired ? 0 : state.requestsInCurrentDay;
    const inFlightLeaseActive =
      state.requestsInFlightLeaseExpiresAt != null &&
      state.requestsInFlightLeaseExpiresAt.getTime() > now.getTime();
    const requestsInFlight = inFlightLeaseActive ? state.requestsInFlight : 0;

    if (requestsInFlight >= config.backendRateLimits.concurrency) {
      return {
        allowed: false,
        reason: 'source_concurrency_limit',
        nextAttemptAt: new Date(now.getTime() + SOURCE_CONCURRENCY_RETRY_MS),
      };
    }

    if (minuteCount >= config.backendRateLimits.requestsPerMinute) {
      return {
        allowed: false,
        reason: 'source_minute_rate_limit',
        nextAttemptAt: state.minuteWindowResetAt ?? minuteResetAt,
      };
    }

    if (dayCount >= config.backendRateLimits.requestsPerDay) {
      return {
        allowed: false,
        reason: 'source_daily_rate_limit',
        nextAttemptAt: state.dayWindowResetAt ?? dayResetAt,
      };
    }

    await tx
      .update(officialValuationSourceStates)
      .set({
        state: state.state === 'open' ? 'half_open' : state.state,
        requestsInCurrentMinute: minuteCount + 1,
        minuteWindowResetAt: minuteExpired ? minuteResetAt : state.minuteWindowResetAt,
        requestsInCurrentDay: dayCount + 1,
        dayWindowResetAt: dayExpired ? dayResetAt : state.dayWindowResetAt,
        requestsInFlight: requestsInFlight + 1,
        requestsInFlightLeaseExpiresAt: new Date(now.getTime() + SOURCE_IN_FLIGHT_LEASE_MS),
        updatedAt: now,
      })
      .where(eq(officialValuationSourceStates.source, source));

    return { allowed: true };
  });
}

export async function releaseOfficialValuationSourceRequest(
  source: OfficialValuationSource,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${source}))`);
    await tx
      .insert(officialValuationSourceStates)
      .values({ source })
      .onConflictDoNothing();

    await tx.execute(sql`
      UPDATE official_valuation_source_states
      SET
        requests_in_flight = GREATEST(requests_in_flight - 1, 0),
        requests_in_flight_lease_expires_at = CASE
          WHEN requests_in_flight <= 1 THEN NULL
          ELSE requests_in_flight_lease_expires_at
        END,
        updated_at = now()
      WHERE source = ${source}
    `);
  });
}

export async function markOfficialValuationHydrationSucceeded(
  jobId: string,
  result: OfficialValuationSourceResult,
): Promise<MaintenanceRefreshRequestRecord> {
  return db.transaction(async (tx) => {
    const jobRows = await tx
      .select()
      .from(propertyOfficialValuationHydrationJobs)
      .where(eq(propertyOfficialValuationHydrationJobs.id, jobId))
      .limit(1);
    const job = jobRows[0];
    if (!job) {
      throw new Error(`Official valuation hydration job ${jobId} not found`);
    }

    await tx.execute(sql`
      INSERT INTO property_official_valuations (
        property_id,
        valuation,
        valuation_year,
        reference_date,
        source,
        source_record_id,
        source_dataset_version,
        source_url,
        raw_payload,
        verified,
        verified_at,
        origin,
        fetched_at
      )
      VALUES (
        ${job.propertyId},
        ${result.valuation},
        ${result.valuationYear},
        ${result.referenceDate ?? null},
        ${job.source},
        ${result.sourceRecordId ?? null},
        ${result.sourceDatasetVersion ?? null},
        ${result.sourceUrl ?? null},
        ${toJsonbParameter(result.rawPayload)}::jsonb,
        true,
        now(),
        'server_verified',
        now()
      )
      ON CONFLICT (property_id, valuation_year, source)
      DO UPDATE SET
        valuation = EXCLUDED.valuation,
        reference_date = EXCLUDED.reference_date,
        source_record_id = EXCLUDED.source_record_id,
        source_dataset_version = EXCLUDED.source_dataset_version,
        source_url = EXCLUDED.source_url,
        raw_payload = EXCLUDED.raw_payload,
        verified = true,
        verified_at = EXCLUDED.verified_at,
        origin = 'server_verified',
        fetched_at = EXCLUDED.fetched_at,
        updated_at = now()
    `);

    await tx
      .update(propertyOfficialValuationHydrationJobs)
      .set({
        state: 'succeeded',
        lastSuccessAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(propertyOfficialValuationHydrationJobs.id, jobId));

    await refreshPropertyOfficialValuationCache(tx, job.propertyId);
    await advancePropertyChangeVersion(job.propertyId, tx);
    await advancePropertyTilePyramidSourceWatermark(['official_valuations'], tx);

    return createOfficialValuationMaintenanceRefreshRequest(tx, {
      propertyId: job.propertyId,
      source: job.source as OfficialValuationSource,
      valuation: result.valuation,
      valuationYear: result.valuationYear,
      origin: 'server_verified',
      idempotencyKey: `official-valuation:${job.id}:attempt:${job.attemptCount}`,
    });
  });
}

export async function markOfficialValuationHydrationRetryable(input: {
  jobId: string;
  source: OfficialValuationSource;
  attemptCount: number;
  error: string;
  nextAttemptAt?: Date;
}): Promise<void> {
  const config = getOfficialValuationSourceConfig(input.source);
  const nextAttemptAt =
    input.nextAttemptAt ?? getFailedHydrationRetryAt(input.attemptCount, config);

  await db
    .update(propertyOfficialValuationHydrationJobs)
    .set({
      state: 'retryable',
      nextAttemptAt,
      lastError: input.error.slice(0, 2_000),
      updatedAt: new Date(),
    })
    .where(eq(propertyOfficialValuationHydrationJobs.id, input.jobId));
}

export async function markOfficialValuationHydrationFailed(input: {
  jobId: string;
  error: string;
}): Promise<void> {
  await db
    .update(propertyOfficialValuationHydrationJobs)
    .set({
      state: 'failed',
      lastError: input.error.slice(0, 2_000),
      updatedAt: new Date(),
    })
    .where(eq(propertyOfficialValuationHydrationJobs.id, input.jobId));
}

export async function markOfficialValuationSourceSuccess(source: OfficialValuationSource): Promise<void> {
  await db
    .update(officialValuationSourceStates)
    .set({
      state: 'healthy',
      consecutiveFailureCount: 0,
      lastSuccessAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(officialValuationSourceStates.source, source));
}

export async function markOfficialValuationSourceFailure(input: {
  source: OfficialValuationSource;
  error: string;
  rateLimited?: boolean;
  retryAt?: Date;
}): Promise<void> {
  const config = getOfficialValuationSourceConfig(input.source);
  const rateLimited = input.rateLimited === true;
  const retryAt = input.retryAt ?? null;

  await db.transaction(async (tx) => {
    await tx
      .insert(officialValuationSourceStates)
      .values({ source: input.source })
      .onConflictDoNothing();

    await tx.execute(sql`
      UPDATE official_valuation_source_states
      SET
        state = CASE
          WHEN ${rateLimited}::boolean THEN 'rate_limited'
          WHEN consecutive_failure_count + 1 >= ${config.circuitOpenAfterFailures} THEN 'open'
          ELSE state
        END,
        circuit_opened_at = CASE
          WHEN consecutive_failure_count + 1 >= ${config.circuitOpenAfterFailures} THEN now()
          ELSE circuit_opened_at
        END,
        circuit_half_open_at = CASE
          WHEN ${retryAt}::timestamptz IS NOT NULL
            THEN ${retryAt}::timestamptz
          WHEN consecutive_failure_count + 1 >= ${config.circuitOpenAfterFailures}
            THEN now() + (${config.circuitCooldownMs} || ' milliseconds')::interval
          ELSE circuit_half_open_at
        END,
        consecutive_failure_count = consecutive_failure_count + 1,
        last_failure_at = now(),
        last_rate_limit_at = CASE WHEN ${rateLimited}::boolean THEN now() ELSE last_rate_limit_at END,
        last_error = ${input.error.slice(0, 2_000)},
        updated_at = now()
      WHERE source = ${input.source}
    `);
  });
}
