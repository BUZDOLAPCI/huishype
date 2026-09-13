import { describe, expect, it } from '@jest/globals';
import { projectListingAvailability, LISTING_AVAILABILITY_GRACE_MS } from '../../services/listing-lifecycle.js';

const positiveAt = new Date('2026-08-14T12:00:00Z');
const state = { status: 'active' as const, lastPositiveAvailabilityAt: positiveAt, availabilityEndedAt: null };
const at = (days: number) => new Date(positiveAt.getTime() + days * 86400000);

describe('positive listing availability grace', () => {
  it('retains active eligibility through missed refreshes and unsuccessful verification', () => {
    const result = projectListingAvailability(state, { kind: 'none', observedAt: at(29) }, at(29));
    expect(result.activeEligible).toBe(true);
    expect(result.lastPositiveAvailabilityAt).toEqual(positiveAt);
  });

  it('expires at exactly thirty days without a fabricated terminal status', () => {
    const result = projectListingAvailability(state, { kind: 'none', observedAt: at(30) }, at(30));
    expect(result.activeEligible).toBe(false);
    expect(result.status).toBe('active');
    expect(result.availabilityEndedAt).toBeNull();
    expect(result.availabilityExpiresAt!.getTime() - positiveAt.getTime()).toBe(LISTING_AVAILABILITY_GRACE_MS);
  });

  it.each(['sold', 'rented', 'withdrawn', 'unavailable'] as const)('applies confirmed %s immediately', (kind) => {
    const result = projectListingAvailability(state, { kind, observedAt: at(1) }, at(1));
    expect(result.activeEligible).toBe(false);
    expect(result.status).toBe(kind === 'unavailable' ? 'active' : kind);
    expect(result.availabilityEndedAt).toEqual(at(1));
  });

  it('does not let replayed positive observations reset the grace or override newer terminal evidence', () => {
    const sold = projectListingAvailability(state, { kind: 'sold', observedAt: at(1) }, at(1));
    const replay = projectListingAvailability(sold, { kind: 'positive', observedAt: positiveAt }, at(20));
    expect(replay).toEqual(sold);
    const expiredReplay = projectListingAvailability(state, { kind: 'positive', observedAt: positiveAt }, at(31));
    expect(expiredReplay.activeEligible).toBe(false);
  });

  it('restores eligibility only from a newer positive observation', () => {
    const sold = projectListingAvailability(state, { kind: 'sold', observedAt: at(1) }, at(1));
    const restored = projectListingAvailability(sold, { kind: 'positive', observedAt: at(2) }, at(2));
    expect(restored.status).toBe('active');
    expect(restored.activeEligible).toBe(true);
    expect(restored.availabilityEndedAt).toEqual(at(1));
    expect(restored.availabilityExpiresAt).toEqual(at(32));
    expect(projectListingAvailability(restored, { kind: 'sold', observedAt: at(1) }, at(2))).toEqual(restored);
  });

  it('gives equal-time confirmed unavailability precedence in either arrival order', () => {
    const ended = projectListingAvailability(state, { kind: 'sold', observedAt: at(1) }, at(1));
    const terminalFirst = projectListingAvailability(ended, { kind: 'positive', observedAt: at(1) }, at(1));
    const positive = projectListingAvailability(state, { kind: 'positive', observedAt: at(1) }, at(1));
    const positiveFirst = projectListingAvailability(positive, { kind: 'sold', observedAt: at(1) }, at(1));
    expect(terminalFirst).toEqual(positiveFirst);
    expect(terminalFirst.activeEligible).toBe(false);
  });

  it('does not grant availability when no positive source observation exists', () => {
    const result = projectListingAvailability({ ...state, lastPositiveAvailabilityAt: null },
      { kind: 'none', observedAt: at(0) }, at(0));
    expect(result.activeEligible).toBe(false);
    expect(result.availabilityExpiresAt).toBeNull();
  });
});
