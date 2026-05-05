import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  db,
  listingCandidateHandoffs,
  type ListingCandidateHandoff,
} from '../../db/index.js';

export const DEFAULT_CANDIDATE_HANDOFF_MAX_ATTEMPTS = 5;
const MAX_ERROR_LENGTH = 1_000;

function truncateError(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? message.slice(0, MAX_ERROR_LENGTH) : message;
}

export function calculateCandidateHandoffRetryAt(attemptCount: number, now = new Date()): Date {
  const delayMs = Math.min(60 * 60_000, 30_000 * (2 ** Math.max(0, Math.min(attemptCount - 1, 7))));
  return new Date(now.getTime() + delayMs);
}

export async function collectDueCandidateHandoffIds(
  limit = 100,
  now = new Date(),
  stalePendingBefore = new Date(now.getTime() - 10 * 60_000),
): Promise<string[]> {
  const rows = await db
    .select({ id: listingCandidateHandoffs.id })
    .from(listingCandidateHandoffs)
    .where(or(
      and(
        inArray(listingCandidateHandoffs.state, ['queued', 'retryable_error']),
        or(isNull(listingCandidateHandoffs.nextAttemptAt), lte(listingCandidateHandoffs.nextAttemptAt, now)),
      ),
      and(
        eq(listingCandidateHandoffs.state, 'pending'),
        lte(listingCandidateHandoffs.lastAttemptAt, stalePendingBefore),
      ),
    ))
    .orderBy(asc(listingCandidateHandoffs.createdAt))
    .limit(limit);

  return rows.map((row) => row.id);
}

export async function claimCandidateHandoff(
  handoffId: string,
  now = new Date(),
  stalePendingBefore = new Date(now.getTime() - 10 * 60_000),
): Promise<ListingCandidateHandoff | null> {
  const [handoff] = await db
    .update(listingCandidateHandoffs)
    .set({
      state: 'pending',
      attemptCount: sql`${listingCandidateHandoffs.attemptCount} + 1`,
      lastAttemptAt: now,
      nextAttemptAt: null,
      lastError: null,
      updatedAt: now,
    })
    .where(and(
      eq(listingCandidateHandoffs.id, handoffId),
      or(
        and(
          inArray(listingCandidateHandoffs.state, ['queued', 'retryable_error']),
          or(isNull(listingCandidateHandoffs.nextAttemptAt), lte(listingCandidateHandoffs.nextAttemptAt, now)),
        ),
        and(
          eq(listingCandidateHandoffs.state, 'pending'),
          lte(listingCandidateHandoffs.lastAttemptAt, stalePendingBefore),
        ),
      ),
    ))
    .returning();

  return handoff ?? null;
}

export async function markCandidateHandoffDelivered(
  handoffId: string,
  now = new Date(),
): Promise<void> {
  await db
    .update(listingCandidateHandoffs)
    .set({
      state: 'delivered',
      nextAttemptAt: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(listingCandidateHandoffs.id, handoffId));
}

export async function markCandidateHandoffFailed(
  handoff: Pick<ListingCandidateHandoff, 'id' | 'attemptCount'>,
  error: Error,
  options: {
    permanent?: boolean;
    maxAttempts?: number;
    now?: Date;
  } = {},
): Promise<'retryable_error' | 'dead_letter'> {
  const now = options.now ?? new Date();
  const maxAttempts = options.maxAttempts ?? DEFAULT_CANDIDATE_HANDOFF_MAX_ATTEMPTS;
  const shouldDeadLetter = options.permanent === true || handoff.attemptCount >= maxAttempts;
  const state = shouldDeadLetter ? 'dead_letter' : 'retryable_error';

  await db
    .update(listingCandidateHandoffs)
    .set({
      state,
      nextAttemptAt: shouldDeadLetter ? null : calculateCandidateHandoffRetryAt(handoff.attemptCount, now),
      lastError: truncateError(error.message),
      updatedAt: now,
    })
    .where(eq(listingCandidateHandoffs.id, handoff.id));

  return state;
}
