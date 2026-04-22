/**
 * Notification API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { getMockAuthUser } from './auth.js';
import { fixedTimestamp } from '../data/visual-fixtures.js';
import { mockPropertyIds, mockUserIds } from '../data/fixtures.js';

type NotificationEventType =
  | 'property_comment'
  | 'comment_reply'
  | 'comment_like'
  | 'property_like'
  | 'property_guess'
  | 'new_follower'
  | 'achievement_unlocked';

interface MockNotificationItem {
  id: string;
  eventType: NotificationEventType;
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
    eventType: 'new_follower',
    propertyId: null,
    commentId: null,
    guessId: null,
    reactionId: null,
    payload: {},
    readAt: null,
    createdAt: fixedTimestamp(0, 6),
    actor: {
      id: mockUserIds.maria,
      displayName: 'Maria Bakker',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=maria',
    },
  },
  {
    id: 'a0000000-0000-4000-a000-000000000102',
    eventType: 'comment_reply',
    propertyId: mockPropertyIds.prinsengracht263,
    commentId: 'a0000000-0000-4000-a000-000000000201',
    guessId: null,
    reactionId: null,
    payload: { contentPreview: 'Eens, maar de historische waarde telt ook mee.' },
    readAt: null,
    createdAt: fixedTimestamp(0, 4),
    actor: {
      id: mockUserIds.pieter,
      displayName: 'Pieter Jansen',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=pieter',
    },
  },
  {
    id: 'a0000000-0000-4000-a000-000000000103',
    eventType: 'comment_like',
    propertyId: null,
    commentId: 'a0000000-0000-4000-a000-000000000202',
    guessId: null,
    reactionId: 'a0000000-0000-4000-a000-000000000401',
    payload: {},
    readAt: fixedTimestamp(0, 2),
    createdAt: fixedTimestamp(0, 2),
    actor: {
      id: mockUserIds.sophie,
      displayName: 'Sophie Meijer',
      profilePhotoUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sophie',
    },
  },
  {
    id: 'a0000000-0000-4000-a000-000000000104',
    eventType: 'property_guess',
    propertyId: mockPropertyIds.coolsingel40,
    commentId: null,
    guessId: 'a0000000-0000-4000-a000-000000000301',
    reactionId: null,
    payload: { accuracy: 97, guessedPrice: 447000, soldPrice: 460000 },
    readAt: null,
    createdAt: fixedTimestamp(0, 1),
    actor: null,
  },
  {
    id: 'a0000000-0000-4000-a000-000000000105',
    eventType: 'achievement_unlocked',
    propertyId: null,
    commentId: null,
    guessId: null,
    reactionId: null,
    payload: { achievementKey: 'sharp_eye', achievementName: 'Sharp Eye' },
    readAt: fixedTimestamp(1, 0),
    createdAt: fixedTimestamp(1, 0),
    actor: null,
  },
];

const readNotifications = new Set<string>(
  mockNotificationItems
    .filter((notification) => notification.readAt !== null)
    .map((notification) => notification.id)
);

export const notificationHandlers = [
  http.get('*/notifications', ({ request }) => {
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

    const items = mockNotificationItems
      .map((notification) => ({
        ...notification,
        readAt: readNotifications.has(notification.id)
          ? (notification.readAt ?? new Date().toISOString())
          : null,
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

  http.get('*/notifications/unread-count', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const count = mockNotificationItems.filter(
      (notification) => !readNotifications.has(notification.id)
    ).length;
    return HttpResponse.json({ count });
  }),

  http.put('*/notifications/read-all', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    let markedCount = 0;
    for (const notification of mockNotificationItems) {
      if (!readNotifications.has(notification.id)) {
        readNotifications.add(notification.id);
        markedCount++;
      }
    }

    return HttpResponse.json({ markedCount });
  }),

  http.put('*/notifications/:id/read', ({ params, request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = params;
    const notification = mockNotificationItems.find((candidate) => candidate.id === id);

    if (!notification || readNotifications.has(notification.id)) {
      return HttpResponse.json(
        { error: 'NOT_FOUND', message: 'Notification not found or already read' },
        { status: 404 }
      );
    }

    readNotifications.add(notification.id);
    return HttpResponse.json({ success: true });
  }),

  http.post('*/push-tokens', async ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as { token: string; deviceId: string; platform: string };
    if (!body.token || !body.deviceId || !body.platform) {
      return HttpResponse.json(
        { error: 'BAD_REQUEST', message: 'Missing required fields' },
        { status: 400 }
      );
    }

    return HttpResponse.json({ success: true });
  }),
];
