/** Positive source evidence grants display eligibility for exactly thirty days. */
export const LISTING_AVAILABILITY_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

type ListingStatus = 'active' | 'sold' | 'rented' | 'withdrawn';

export interface ListingAvailabilityState {
  status: ListingStatus;
  lastPositiveAvailabilityAt: Date | null;
  availabilityEndedAt: Date | null;
}

export interface ListingAvailabilityProjection extends ListingAvailabilityState {
  availabilityExpiresAt: Date | null;
  activeEligible: boolean;
}

export interface ListingAvailabilityEvidence {
  kind: 'positive' | 'sold' | 'rented' | 'withdrawn' | 'unavailable' | 'none';
  observedAt: Date;
}

/**
 * Merge actual observation times, never arrival/replay times. Missing inventory,
 * a not-found response, and failed verification carry no availability evidence.
 * Equal-time unavailability takes precedence, independent of delivery order.
 */
export function projectListingAvailability(
  existing: ListingAvailabilityState,
  evidence: ListingAvailabilityEvidence,
  now = new Date(),
): ListingAvailabilityProjection {
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(evidence.observedAt.getTime())) {
    throw new Error('Listing availability requires valid observation and evaluation times');
  }
  let { status, lastPositiveAvailabilityAt, availabilityEndedAt } = existing;
  const observedTime = evidence.observedAt.getTime();
  const positiveTime = lastPositiveAvailabilityAt?.getTime() ?? -Infinity;
  const endedTime = availabilityEndedAt?.getTime() ?? -Infinity;

  if (evidence.kind === 'positive' && observedTime > positiveTime) {
    lastPositiveAvailabilityAt = evidence.observedAt;
    if (observedTime > endedTime) status = 'active';
  } else if (evidence.kind !== 'none' && evidence.kind !== 'positive' && observedTime >= endedTime) {
    availabilityEndedAt = evidence.observedAt;
    if (observedTime >= positiveTime && evidence.kind !== 'unavailable') {
      status = evidence.kind;
    }
  }

  const availabilityExpiresAt = lastPositiveAvailabilityAt
    ? new Date(lastPositiveAvailabilityAt.getTime() + LISTING_AVAILABILITY_GRACE_MS)
    : null;
  return {
    status,
    lastPositiveAvailabilityAt,
    availabilityEndedAt,
    availabilityExpiresAt,
    activeEligible: status === 'active'
      && availabilityExpiresAt !== null
      && availabilityExpiresAt.getTime() > now.getTime()
      && (availabilityEndedAt === null
        || lastPositiveAvailabilityAt!.getTime() > availabilityEndedAt.getTime()),
  };
}

/** Read-time guard keeps the exact boundary correct between worker sweeps. */
export function isListingActiveEligible(
  listing: { status: ListingStatus; activeEligible: boolean; availabilityExpiresAt: Date | null },
  now = new Date(),
): boolean {
  return listing.status === 'active' && listing.activeEligible
    && listing.availabilityExpiresAt !== null
    && listing.availabilityExpiresAt.getTime() > now.getTime();
}
