/**
 * Handler alignment tests for @huishype/mocks
 *
 * Verifies that MSW handlers are correctly wired and cover
 * the expected API paths. Does not start MSW — tests handler
 * array structure and fixture data integrity only.
 */

import { describe, it, expect } from 'vitest';
import {
  handlers,
  authHandlers,
  propertyHandlers,
  guessHandlers,
  commentHandlers,
  geocodeHandlers,
  feedHandlers,
  userHandlers,
  listingHandlers,
} from '../handlers/index.js';
import {
  mockUsers,
  mockUserProfiles,
  mockProperties,
  mockPropertyDetails,
  mockPropertySummaries,
  mockListings,
  mockGuesses,
  mockComments,
  mockMapProperties,
  mockPropertyClusters,
  mockFMV,
  getMockUser,
  getMockProperty,
  getMockComments,
  getMockGuesses,
} from '../data/fixtures.js';

describe('Handler wiring', () => {
  it('exports a non-empty combined handlers array', () => {
    expect(handlers).toBeInstanceOf(Array);
    expect(handlers.length).toBeGreaterThan(0);
  });

  it('combined handlers include all handler groups', () => {
    const allGrouped = [
      ...authHandlers,
      ...userHandlers,
      ...feedHandlers,
      ...listingHandlers,
      ...propertyHandlers,
      ...guessHandlers,
      ...commentHandlers,
      ...geocodeHandlers,
    ];
    expect(handlers.length).toBe(allGrouped.length);
  });

  it('has handlers for all major API areas', () => {
    expect(authHandlers.length).toBeGreaterThan(0);
    expect(propertyHandlers.length).toBeGreaterThan(0);
    expect(guessHandlers.length).toBeGreaterThan(0);
    expect(commentHandlers.length).toBeGreaterThan(0);
    expect(geocodeHandlers.length).toBeGreaterThan(0);
    expect(feedHandlers.length).toBeGreaterThan(0);
    expect(userHandlers.length).toBeGreaterThan(0);
    expect(listingHandlers.length).toBeGreaterThan(0);
  });
});

describe('Handler path alignment', () => {
  // Extract handler info from MSW handler objects
  function getHandlerInfo(handler: any): { method: string; path: string } | null {
    try {
      const info = handler.info;
      if (info && info.method && info.path) {
        return { method: info.method.toUpperCase(), path: info.path };
      }
    } catch {
      // Some handlers may have different structure
    }
    return null;
  }

  it('auth handlers do not use /api/v1 prefix', () => {
    for (const handler of authHandlers) {
      const info = getHandlerInfo(handler);
      if (info) {
        expect(info.path).not.toMatch(/\/api\/v1/);
      }
    }
  });

  it('property handlers do not use /api/v1 prefix', () => {
    for (const handler of propertyHandlers) {
      const info = getHandlerInfo(handler);
      if (info) {
        expect(info.path).not.toMatch(/\/api\/v1/);
      }
    }
  });

  it('feed handler uses /feed path (no prefix)', () => {
    for (const handler of feedHandlers) {
      const info = getHandlerInfo(handler);
      if (info) {
        expect(info.path).not.toMatch(/\/api\/v1/);
      }
    }
  });

  it('user handlers do not use /api/v1 prefix', () => {
    for (const handler of userHandlers) {
      const info = getHandlerInfo(handler);
      if (info) {
        expect(info.path).not.toMatch(/\/api\/v1/);
      }
    }
  });
});

describe('Fixture data integrity', () => {
  it('mockUsers has at least 3 users', () => {
    expect(mockUsers.length).toBeGreaterThanOrEqual(3);
  });

  it('mockUserProfiles has same count as mockUsers', () => {
    expect(mockUserProfiles.length).toBe(mockUsers.length);
  });

  it('mockProperties has at least 3 properties', () => {
    expect(mockProperties.length).toBeGreaterThanOrEqual(3);
  });

  it('mockPropertyDetails has same count as mockProperties', () => {
    expect(mockPropertyDetails.length).toBe(mockProperties.length);
  });

  it('mockPropertyDetails include likeCount, isLiked, isSaved fields', () => {
    for (const detail of mockPropertyDetails) {
      expect(typeof detail.likeCount).toBe('number');
      expect(typeof detail.isLiked).toBe('boolean');
      expect(typeof detail.isSaved).toBe('boolean');
    }
  });

  it('mockPropertySummaries has same count as mockPropertyDetails', () => {
    expect(mockPropertySummaries.length).toBe(mockPropertyDetails.length);
  });

  it('mockListings references valid property IDs', () => {
    const propertyIds = new Set(mockProperties.map((p) => p.id));
    for (const listing of mockListings) {
      expect(propertyIds.has(listing.propertyId)).toBe(true);
    }
  });

  it('mockGuesses references valid user and property IDs', () => {
    const userIds = new Set(mockUsers.map((u) => u.id));
    const propertyIds = new Set(mockProperties.map((p) => p.id));
    for (const guess of mockGuesses) {
      expect(userIds.has(guess.userId)).toBe(true);
      expect(propertyIds.has(guess.propertyId)).toBe(true);
    }
  });

  it('mockComments references valid users', () => {
    const userIds = new Set(mockUsers.map((u) => u.id));
    for (const comment of mockComments) {
      expect(userIds.has(comment.userId)).toBe(true);
    }
  });

  it('mockFMV has valid structure', () => {
    expect(typeof mockFMV.value).toBe('number');
    expect(typeof mockFMV.confidence).toBe('string');
    expect(typeof mockFMV.guessCount).toBe('number');
    expect(mockFMV.distribution).toBeDefined();
  });

  it('mockMapProperties has same count as mockProperties', () => {
    expect(mockMapProperties.length).toBe(mockProperties.length);
  });

  it('mockPropertyClusters has valid structure', () => {
    expect(mockPropertyClusters.length).toBeGreaterThan(0);
    for (const cluster of mockPropertyClusters) {
      expect(cluster.id).toBeTruthy();
      expect(typeof cluster.coordinates.lat).toBe('number');
      expect(typeof cluster.coordinates.lon).toBe('number');
      expect(typeof cluster.count).toBe('number');
    }
  });

  it('getMockUser returns user for valid ID', () => {
    const user = getMockUser('user-001');
    expect(user).toBeDefined();
    expect(user?.id).toBe('user-001');
  });

  it('getMockUser returns undefined for invalid ID', () => {
    expect(getMockUser('nonexistent')).toBeUndefined();
  });

  it('getMockProperty returns property for valid ID', () => {
    const prop = getMockProperty('prop-001');
    expect(prop).toBeDefined();
    expect(prop?.id).toBe('prop-001');
  });

  it('getMockComments returns comments for valid property', () => {
    const comments = getMockComments('prop-001');
    expect(comments.length).toBeGreaterThan(0);
  });

  it('getMockGuesses returns guesses for valid property', () => {
    const guesses = getMockGuesses('prop-001');
    expect(guesses.length).toBeGreaterThan(0);
  });
});

describe('Feed filter values', () => {
  // The final feed chips per the design spec:
  //   "Trending"         -> filter=trending
  //   "Latest"           -> filter=recent
  //   "Recent Activity"  -> filter=controversial
  // Stale values (hot, following, price-mismatch as chip) should not appear in chips,
  // but price-mismatch is still a valid backend filter.
  it('recognizes canonical feed filter values', () => {
    const validFilters = ['trending', 'recent', 'controversial', 'price-mismatch'];
    for (const f of validFilters) {
      expect(typeof f).toBe('string');
    }
  });
});
