/**
 * Notification API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { getMockAuthUser } from './auth.js';
import { fixedTimestamp } from '../data/visual-fixtures.js';

// --- Mock notification data aligned with OpenAPI schema ---

interface MockNotificationItem {
  id: string;
  eventType: string;
  propertyId: string | null;
  commentId: string | null;
  guessId: string | null;
  reactionId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  actor: {
    id: string;
    displayName: string;
    profilePhotoUrl: string | null;
  } | null;
}

const mockNotificationItems: MockNotificationItem[] = [
  {
    id: 'a0000000-0000-4000-a000-000000000101',
    eventType: 'comment_reply',
    propertyId: 'a0000000-0000-4000-a000-000000000001',
    commentId: 'a0000000-0000-4000-a000-000000000201',
    guessId: null,
    reactionId: null,
    payload: { contentPreview: 'Eens! Maar de historische waarde van dit pand is wel uniek.' },
    readAt: null,
    createdAt: fixedTimestamp(0, 2),
    actor: {
      id: 'user-002',
      displayName: 'Maria Bakker',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=maria',
    },
  },
  {
    id: 'a0000000-0000-4000-a000-000000000102',
    eventType: 'like',
    propertyId: 'a0000000-0000-4000-a000-000000000001',
    commentId: null,
    guessId: 'a0000000-0000-4000-a000-000000000301',
    reactionId: 'a0000000-0000-4000-a000-000000000401',
    payload: {},
    readAt: null,
    createdAt: fixedTimestamp(0, 5),
    actor: {
      id: 'user-004',
      displayName: 'Sophie Meijer',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sophie',
    },
  },
  {
    id: 'a0000000-0000-4000-a000-000000000103',
    eventType: 'property_update',
    propertyId: 'a0000000-0000-4000-a000-000000000002',
    commentId: null,
    guessId: null,
    reactionId: null,
    payload: { oldPrice: 2200000, newPrice: 2100000 },
    readAt: fixedTimestamp(1, 1),
    createdAt: fixedTimestamp(1, 3),
    actor: null,
  },
  {
    id: 'a0000000-0000-4000-a000-000000000104',
    eventType: 'guess_result',
    propertyId: 'a0000000-0000-4000-a000-000000000003',
    commentId: null,
    guessId: 'a0000000-0000-4000-a000-000000000302',
    reactionId: null,
    payload: { soldPrice: 460000, guessedPrice: 447000, accuracy: 97 },
    readAt: fixedTimestamp(2, 1),
    createdAt: fixedTimestamp(2, 0),
    actor: null,
  },
  {
    id: 'a0000000-0000-4000-a000-000000000105',
    eventType: 'achievement',
    propertyId: null,
    commentId: null,
    guessId: null,
    reactionId: null,
    payload: { achievementKey: 'sharp_eye', achievementName: 'Sharp Eye' },
    readAt: fixedTimestamp(3, 5),
    createdAt: fixedTimestamp(3, 6),
    actor: null,
  },
  {
    id: 'a0000000-0000-4000-a000-000000000106',
    eventType: 'comment_reply',
    propertyId: 'a0000000-0000-4000-a000-000000000001',
    commentId: 'a0000000-0000-4000-a000-000000000202',
    guessId: null,
    reactionId: null,
    payload: { contentPreview: 'Zou het pand ook voor verhuur geschikt zijn?' },
    readAt: fixedTimestamp(4, 0),
    createdAt: fixedTimestamp(4, 1),
    actor: {
      id: 'user-003',
      displayName: 'Pieter Jansen',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=pieter',
    },
  },
];

// In-memory read state for testing
const readNotifications = new Set<string>(
  mockNotificationItems.filter((n) => n.readAt !== null).map((n) => n.id)
);

export const notificationHandlers = [
  /**
   * GET /notifications — paginated notification list
   */
  http.get('/notifications', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'), request.headers.get('Cookie'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const items = mockNotificationItems
      .map((n) => ({
        ...n,
        readAt: readNotifications.has(n.id) ? (n.readAt ?? new Date().toISOString()) : null,
      }))
      .slice(offset, offset + limit);

    return HttpResponse.json({
      items,
      pagination: {
        total: mockNotificationItems.length,
        limit,
        offset,
        hasMore: offset + limit < mockNotificationItems.length,
      },
    });
  }),

  /**
   * GET /notifications/unread-count
   */
  http.get('/notifications/unread-count', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'), request.headers.get('Cookie'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const count = mockNotificationItems.filter((n) => !readNotifications.has(n.id)).length;
    return HttpResponse.json({ count });
  }),

  /**
   * PUT /notifications/read-all
   */
  http.put('/notifications/read-all', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'), request.headers.get('Cookie'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    let markedCount = 0;
    for (const n of mockNotificationItems) {
      if (!readNotifications.has(n.id)) {
        readNotifications.add(n.id);
        markedCount++;
      }
    }

    return HttpResponse.json({ markedCount });
  }),

  /**
   * PUT /notifications/:id/read
   */
  http.put('/notifications/:id/read', ({ params, request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'), request.headers.get('Cookie'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = params;
    const notification = mockNotificationItems.find((n) => n.id === id);

    if (!notification) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Notification not found or already read' },
        { status: 404 }
      );
    }

    readNotifications.add(notification.id);
    return HttpResponse.json({ success: true });
  }),

  /**
   * POST /push-tokens — register a device push token
   */
  http.post('/push-tokens', async ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'), request.headers.get('Cookie'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json() as { token: string; deviceId: string; platform: string };
    if (!body.token || !body.deviceId || !body.platform) {
      return HttpResponse.json(
        { error: 'BAD_REQUEST', message: 'Missing required fields' },
        { status: 400 }
      );
    }

    return HttpResponse.json({ success: true });
  }),
];
