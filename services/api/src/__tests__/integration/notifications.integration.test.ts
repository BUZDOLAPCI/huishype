import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { buildApp } from '../../app.js';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { users, notifications, pushTokens } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { createNotification } from '../../services/notifications.js';

describe('Notification routes', () => {
  let app: FastifyInstance;
  let userId: string;
  let accessToken: string;
  let actorId: string;
  const testUserIds: string[] = [];

  beforeAll(async () => {
    app = await buildApp({ logger: false });

    // Create test user (recipient)
    const uniqueId = `notiftest${Date.now()}`;
    const loginResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${uniqueId}-gid${uniqueId}` },
    });
    const loginBody = JSON.parse(loginResp.body);
    userId = loginBody.session.user.id;
    accessToken = loginBody.session.accessToken;
    testUserIds.push(userId);

    // Create actor user
    const actorUniqueId = `notifactor${Date.now()}`;
    const actorResp = await app.inject({
      method: 'POST',
      url: '/auth/google',
      payload: { idToken: `mock-google-${actorUniqueId}-gid${actorUniqueId}` },
    });
    const actorBody = JSON.parse(actorResp.body);
    actorId = actorBody.session.user.id;
    testUserIds.push(actorId);
  });

  afterAll(async () => {
    // Clean up
    for (const uid of testUserIds) {
      try {
        await db.delete(notifications).where(eq(notifications.recipientUserId, uid));
        await db.delete(pushTokens).where(eq(pushTokens.userId, uid));
        await db.delete(users).where(eq(users.id, uid));
      } catch {
        // Ignore
      }
    }
    if (app) {
      await app.close();
    }
  });

  describe('GET /notifications', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/notifications',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return empty list initially', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/notifications',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });

    it('should return notifications after creation', async () => {
      // Create a notification via service
      await createNotification({
        recipientUserId: userId,
        actorUserId: actorId,
        eventType: 'property_like',
        payload: { test: true },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/notifications',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBe(1);
      expect(body.items[0].eventType).toBe('property_like');
      expect(body.items[0].readAt).toBeNull();
      expect(body.items[0].actor).not.toBeNull();
      expect(body.items[0].actor.id).toBe(actorId);
      expect(typeof body.items[0].actor.handle).toBe('string');
    });

    it('returns canonical notification event names including new_follower', async () => {
      await createNotification({
        recipientUserId: userId,
        actorUserId: actorId,
        eventType: 'new_follower',
        payload: {},
      });

      const response = await app.inject({
        method: 'GET',
        url: '/notifications?limit=20',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const newFollowerNotification = body.items.find(
        (item: { eventType: string }) => item.eventType === 'new_follower'
      );

      expect(newFollowerNotification).toBeDefined();
    });
  });

  describe('GET /notifications/unread-count', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/notifications/unread-count',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return unread count', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/notifications/unread-count',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PUT /notifications/:id/read', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/notifications/00000000-0000-4000-a000-000000000001/read',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should mark a notification as read', async () => {
      // Get a notification id
      const listResp = await app.inject({
        method: 'GET',
        url: '/notifications',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const listBody = JSON.parse(listResp.body);
      expect(listBody.items.length).toBeGreaterThan(0);
      const notifId = listBody.items[0].id;

      const response = await app.inject({
        method: 'PUT',
        url: `/notifications/${notifId}/read`,
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should return 404 for already-read notification', async () => {
      const listResp = await app.inject({
        method: 'GET',
        url: '/notifications',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const listBody = JSON.parse(listResp.body);
      const readNotif = listBody.items.find((n: { readAt: string | null }) => n.readAt !== null);

      if (readNotif) {
        const response = await app.inject({
          method: 'PUT',
          url: `/notifications/${readNotif.id}/read`,
          headers: { authorization: `Bearer ${accessToken}` },
        });
        expect(response.statusCode).toBe(404);
      }
    });
  });

  describe('PUT /notifications/read-all', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/notifications/read-all',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should mark all notifications as read', async () => {
      // Create another unread notification
      await createNotification({
        recipientUserId: userId,
        actorUserId: actorId,
        eventType: 'comment_reply',
        payload: {},
      });

      const response = await app.inject({
        method: 'PUT',
        url: '/notifications/read-all',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.markedCount).toBeGreaterThanOrEqual(1);

      // Verify all are read
      const countResp = await app.inject({
        method: 'GET',
        url: '/notifications/unread-count',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const countBody = JSON.parse(countResp.body);
      expect(countBody.count).toBe(0);
    });
  });

  describe('POST /push-tokens', () => {
    it('should return 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/push-tokens',
        payload: { token: 'ExponentPushToken[xxx]', deviceId: 'test-device', platform: 'android' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should register a push token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/push-tokens',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          token: 'ExponentPushToken[testtoken123]',
          deviceId: 'test-device-001',
          platform: 'android',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should upsert on same device', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/push-tokens',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          token: 'ExponentPushToken[updatedtoken456]',
          deviceId: 'test-device-001',
          platform: 'android',
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('Self-notification suppression', () => {
    it('should not create notification when actor === recipient', async () => {
      const before = await app.inject({
        method: 'GET',
        url: '/notifications',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const beforeCount = JSON.parse(before.body).pagination.total;

      // Self-notify
      const result = await createNotification({
        recipientUserId: userId,
        actorUserId: userId,
        eventType: 'property_like',
      });
      expect(result).toBeNull();

      const after = await app.inject({
        method: 'GET',
        url: '/notifications',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const afterCount = JSON.parse(after.body).pagination.total;
      expect(afterCount).toBe(beforeCount);
    });
  });
});
