/**
 * Notification service — create, read, and push delivery.
 *
 * Display copy is derived from event_type + payload at the API layer,
 * never persisted as localized text.
 */

import { db, type DbTransaction } from '../db/index.js';
import { notifications, pushTokens } from '../db/schema.js';
import { eq, and, sql, isNull } from 'drizzle-orm';

/** Minimal logger interface matching Fastify's log methods. */
interface Logger {
  warn: (msgOrObj: unknown, ...args: unknown[]) => void;
}

let _logger: Logger = console;

/** Inject the Fastify logger so service functions use structured logging. */
export function setNotificationLogger(logger: Logger): void {
  _logger = logger;
}

// ─── Types ─────────────────────────────────────────────────────────────

export const notificationEventTypes = [
  'property_comment',
  'comment_reply',
  'comment_like',
  'property_like',
  'property_guess',
  'new_follower',
  'achievement_unlocked',
] as const;

export type NotificationEventType = (typeof notificationEventTypes)[number];

export interface CreateNotificationParams {
  recipientUserId: string;
  actorUserId?: string;
  eventType: NotificationEventType;
  propertyId?: string;
  commentId?: string;
  guessId?: string;
  reactionId?: string;
  payload?: Record<string, unknown>;
}

export interface NotificationRow {
  id: string;
  eventType: NotificationEventType;
  propertyId: string | null;
  commentId: string | null;
  guessId: string | null;
  reactionId: string | null;
  payload: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
  actor: {
    id: string;
    displayName: string;
    handle: string;
    profilePhotoUrl: string | null;
  } | null;
}

type NotificationExecutor = typeof db | DbTransaction;

// ─── Create ────────────────────────────────────────────────────────────

/**
 * Create a notification. Does NOT send push — call sendPush separately.
 * Skips creation if recipient === actor (no self-notifications).
 */
export async function createNotification(
  params: CreateNotificationParams,
  executor: NotificationExecutor = db,
): Promise<string | null> {
  // Don't notify yourself
  if (params.actorUserId && params.recipientUserId === params.actorUserId) {
    return null;
  }

  const [row] = await executor
    .insert(notifications)
    .values({
      recipientUserId: params.recipientUserId,
      actorUserId: params.actorUserId ?? null,
      eventType: params.eventType,
      propertyId: params.propertyId ?? null,
      commentId: params.commentId ?? null,
      guessId: params.guessId ?? null,
      reactionId: params.reactionId ?? null,
      payload: params.payload ?? {},
    })
    .returning({ id: notifications.id });

  return row.id;
}

// ─── Query ─────────────────────────────────────────────────────────────

export async function getNotifications(
  userId: string,
  limit: number,
  offset: number
): Promise<{ items: NotificationRow[]; total: number }> {
  const countResult = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notifications)
    .where(eq(notifications.recipientUserId, userId));
  const total = countResult[0]?.value ?? 0;

  if (total === 0) {
    return { items: [], total: 0 };
  }

  const rows = await db.execute<{
    id: string;
    event_type: NotificationEventType;
    property_id: string | null;
    comment_id: string | null;
    guess_id: string | null;
    reaction_id: string | null;
    payload: Record<string, unknown> | null;
    read_at: string | null;
    created_at: string;
    actor_id: string | null;
    actor_display_name: string | null;
    actor_handle: string | null;
    actor_photo_url: string | null;
  }>(sql`
    SELECT
      n.id,
      n.event_type,
      n.property_id,
      n.comment_id,
      n.guess_id,
      n.reaction_id,
      n.payload,
      n.read_at,
      n.created_at,
      u.id AS actor_id,
      COALESCE(u.display_name, u.username) AS actor_display_name,
      u.username AS actor_handle,
      u.profile_photo_url AS actor_photo_url
    FROM notifications n
    LEFT JOIN users u ON u.id = n.actor_user_id
    WHERE n.recipient_user_id = ${userId}
    ORDER BY n.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  const items: NotificationRow[] = Array.from(rows).map((r) => ({
    id: r.id,
    eventType: r.event_type,
    propertyId: r.property_id,
    commentId: r.comment_id,
    guessId: r.guess_id,
    reactionId: r.reaction_id,
    payload: r.payload,
    readAt: r.read_at ? new Date(r.read_at) : null,
    createdAt: new Date(r.created_at),
    actor: r.actor_id
      ? {
          id: r.actor_id,
          displayName: r.actor_display_name!,
          handle: r.actor_handle!,
          profilePhotoUrl: r.actor_photo_url,
        }
      : null,
  }));

  return { items, total };
}

export async function getUnreadCount(userId: string): Promise<number> {
  const result = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)));
  return result[0]?.value ?? 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return result.length;
}

export async function markOneRead(notificationId: string, userId: string): Promise<boolean> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.recipientUserId, userId),
        isNull(notifications.readAt)
      )
    )
    .returning({ id: notifications.id });
  return result.length > 0;
}

// ─── Push Token Management ─────────────────────────────────────────────

export async function registerPushToken(
  userId: string,
  token: string,
  deviceId: string,
  platform: string
): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ userId, token, deviceId, platform })
    .onConflictDoUpdate({
      target: [pushTokens.userId, pushTokens.deviceId],
      set: { token, platform, updatedAt: new Date() },
    });
}

export async function getUserPushTokens(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId));
  return rows.map((r) => r.token);
}

/**
 * Send push notification via Expo Push API.
 * This is a best-effort delivery — failures are logged but not retried.
 *
 * Requires the expo-server-sdk package. If not available, this is a no-op
 * that logs a warning. Push delivery can be wired to a queue for reliability.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  const tokens = await getUserPushTokens(userId);
  if (tokens.length === 0) return;

  // Best-effort push delivery via Expo Push API
  // In production, use expo-server-sdk. For now, use the REST API directly.
  try {
    const messages = tokens.map((token) => ({
      to: token,
      title,
      body,
      data: data ?? {},
      sound: 'default' as const,
    }));

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      _logger.warn(`Push delivery failed for user ${userId}: ${response.status}`);
    }
  } catch (err) {
    _logger.warn({ err, userId }, `Push delivery error for user ${userId}`);
  }
}
