/**
 * Activity API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { getMockAuthUser } from './auth.js';
import { fixedTimestamp } from '../data/visual-fixtures.js';

// --- Mock activity data aligned with OpenAPI schema ---

interface ActivityItem {
  id: string;
  eventType: 'property_like' | 'comment' | 'price_guess' | 'save';
  actor: {
    id: string;
    displayName: string;
    handle: string;
    profilePhotoUrl: string | null;
  };
  property: {
    id: string;
    address: string;
    city: string;
    thumbnailUrl: string | null;
  };
  createdAt: string;
  meta: Record<string, unknown> | null;
}

const mockPublicActivity: ActivityItem[] = [
  {
    id: 'activity-pub-001',
    eventType: 'price_guess',
    actor: {
      id: 'user-004',
      displayName: 'Sophie Meijer',
      handle: 'sophiemeijer',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sophie',
    },
    property: {
      id: 'prop-001',
      address: 'Prinsengracht 263, Amsterdam',
      city: 'Amsterdam',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 1),
    meta: { isMemeGuess: false },
  },
  {
    id: 'activity-pub-002',
    eventType: 'comment',
    actor: {
      id: 'user-002',
      displayName: 'Maria Bakker',
      handle: 'mariabakker',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=maria',
    },
    property: {
      id: 'prop-002',
      address: 'Herengracht 502, Amsterdam',
      city: 'Amsterdam',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 3),
    meta: { contentPreview: 'Mooi pand maar de prijs is wel hoog' },
  },
  {
    id: 'activity-pub-003',
    eventType: 'property_like',
    actor: {
      id: 'user-003',
      displayName: 'Pieter Jansen',
      handle: 'pieterjansen',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=pieter',
    },
    property: {
      id: 'prop-003',
      address: 'Coolsingel 40, Rotterdam',
      city: 'Rotterdam',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(1, 0),
    meta: null,
  },
  {
    id: 'activity-pub-004',
    eventType: 'price_guess',
    actor: {
      id: 'user-001',
      displayName: 'Jan de Vries',
      handle: 'jandevries',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    },
    property: {
      id: 'prop-004',
      address: 'Lange Voorhout 102, Den Haag',
      city: 'Den Haag',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(1, 4),
    meta: { isMemeGuess: false },
  },
  {
    id: 'activity-pub-005',
    eventType: 'comment',
    actor: {
      id: 'user-006',
      displayName: 'Emma van Dijk',
      handle: 'emmavandijk',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=emma',
    },
    property: {
      id: 'prop-001',
      address: 'Prinsengracht 263, Amsterdam',
      city: 'Amsterdam',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(2, 2),
    meta: { contentPreview: 'Wat een locatie!' },
  },
];

// Personal activity includes saves (private)
const mockPersonalActivity: ActivityItem[] = [
  {
    id: 'activity-me-001',
    eventType: 'price_guess',
    actor: {
      id: 'user-001',
      displayName: 'Jan de Vries',
      handle: 'jandevries',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    },
    property: {
      id: 'prop-001',
      address: 'Prinsengracht 263, Amsterdam',
      city: 'Amsterdam',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(0, 3),
    meta: { isMemeGuess: false },
  },
  {
    id: 'activity-me-002',
    eventType: 'comment',
    actor: {
      id: 'user-001',
      displayName: 'Jan de Vries',
      handle: 'jandevries',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    },
    property: {
      id: 'prop-002',
      address: 'Herengracht 502, Amsterdam',
      city: 'Amsterdam',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(1, 1),
    meta: { contentPreview: 'Prachtig grachtenpand' },
  },
  {
    id: 'activity-me-003',
    eventType: 'property_like',
    actor: {
      id: 'user-001',
      displayName: 'Jan de Vries',
      handle: 'jandevries',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    },
    property: {
      id: 'prop-003',
      address: 'Coolsingel 40, Rotterdam',
      city: 'Rotterdam',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(2, 5),
    meta: null,
  },
  {
    id: 'activity-me-004',
    eventType: 'save',
    actor: {
      id: 'user-001',
      displayName: 'Jan de Vries',
      handle: 'jandevries',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jan',
    },
    property: {
      id: 'prop-004',
      address: 'Lange Voorhout 102, Den Haag',
      city: 'Den Haag',
      thumbnailUrl: null,
    },
    createdAt: fixedTimestamp(3, 2),
    meta: null,
  },
];

export const activityHandlers = [
  /**
   * GET /activity — public social activity feed
   */
  http.get('/activity', ({ request }) => {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const items = mockPublicActivity.slice(offset, offset + limit);

    return HttpResponse.json({
      items,
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < mockPublicActivity.length,
      },
    });
  }),

  /**
   * GET /users/me/activity — personal activity history (includes saves)
   */
  http.get('/users/me/activity', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const items = mockPersonalActivity.slice(offset, offset + limit);

    return HttpResponse.json({
      items,
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < mockPersonalActivity.length,
      },
    });
  }),
];
