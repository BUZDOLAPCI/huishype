import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { userFollows, users } from '../db/schema.js';
import { createNotification } from './notifications.js';

export type FollowRelationship = 'self' | 'none' | 'following' | 'followed_by' | 'mutual';

export interface FollowCounts {
  followerCount: number;
  followingCount: number;
}

export interface FollowRelationshipPayload extends FollowCounts {
  relationship: FollowRelationship;
}

export interface FollowListUser {
  id: string;
  displayName: string;
  handle: string;
  profilePhotoUrl: string | null;
  followedAt: string;
  relationship: FollowRelationship;
}

export interface FollowListResponse {
  items: FollowListUser[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export function deriveFollowRelationship(params: {
  viewerId: string | null;
  targetUserId: string;
  isFollowing: boolean;
  isFollowedBy: boolean;
}): FollowRelationship {
  if (params.viewerId === params.targetUserId) {
    return 'self';
  }

  if (params.isFollowing && params.isFollowedBy) {
    return 'mutual';
  }

  if (params.isFollowing) {
    return 'following';
  }

  if (params.isFollowedBy) {
    return 'followed_by';
  }

  return 'none';
}

export async function getFollowCounts(userId: string): Promise<FollowCounts> {
  const result = await db.execute<{
    follower_count: number;
    following_count: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM user_follows WHERE followed_user_id = ${userId}) AS follower_count,
      (SELECT COUNT(*)::int FROM user_follows WHERE follower_user_id = ${userId}) AS following_count
  `);

  const row = Array.from(result)[0];
  return {
    followerCount: row?.follower_count ?? 0,
    followingCount: row?.following_count ?? 0,
  };
}

export async function getFollowRelationshipPayload(
  targetUserId: string,
  viewerId: string | null,
): Promise<FollowRelationshipPayload> {
  const counts = await getFollowCounts(targetUserId);

  if (!viewerId) {
    return {
      ...counts,
      relationship: 'none',
    };
  }

  if (viewerId === targetUserId) {
    return {
      ...counts,
      relationship: 'self',
    };
  }

  const relationshipRows = await db.execute<{
    is_following: boolean;
    is_followed_by: boolean;
  }>(sql`
    SELECT
      EXISTS(
        SELECT 1
        FROM user_follows uf
        WHERE uf.follower_user_id = ${viewerId}
          AND uf.followed_user_id = ${targetUserId}
      ) AS is_following,
      EXISTS(
        SELECT 1
        FROM user_follows uf
        WHERE uf.follower_user_id = ${targetUserId}
          AND uf.followed_user_id = ${viewerId}
      ) AS is_followed_by
  `);

  const relationshipRow = Array.from(relationshipRows)[0];
  return {
    ...counts,
    relationship: deriveFollowRelationship({
      viewerId,
      targetUserId,
      isFollowing: relationshipRow?.is_following ?? false,
      isFollowedBy: relationshipRow?.is_followed_by ?? false,
    }),
  };
}

async function listFollowUsers(params: {
  mode: 'followers' | 'following';
  viewerId: string;
  limit: number;
  offset: number;
}): Promise<FollowListResponse> {
  const directionColumn =
    params.mode === 'followers' ? sql.raw('uf.follower_user_id') : sql.raw('uf.followed_user_id');
  const ownerColumn =
    params.mode === 'followers' ? sql.raw('uf.followed_user_id') : sql.raw('uf.follower_user_id');

  const rows = await db.execute<{
    id: string;
    display_name: string;
    handle: string;
    profile_photo_url: string | null;
    followed_at: string;
    is_following: boolean;
    is_followed_by: boolean;
  }>(sql`
    SELECT
      u.id,
      COALESCE(u.display_name, u.username) AS display_name,
      u.username AS handle,
      u.profile_photo_url,
      uf.created_at AS followed_at,
      EXISTS(
        SELECT 1
        FROM user_follows viewer_follows
        WHERE viewer_follows.follower_user_id = ${params.viewerId}
          AND viewer_follows.followed_user_id = u.id
      ) AS is_following,
      EXISTS(
        SELECT 1
        FROM user_follows follows_viewer
        WHERE follows_viewer.follower_user_id = u.id
          AND follows_viewer.followed_user_id = ${params.viewerId}
      ) AS is_followed_by
    FROM user_follows uf
    INNER JOIN users u ON u.id = ${directionColumn}
    WHERE ${ownerColumn} = ${params.viewerId}
    ORDER BY uf.created_at DESC, u.id
    LIMIT ${params.limit + 1}
    OFFSET ${params.offset}
  `);

  const allRows = Array.from(rows);
  const hasMore = allRows.length > params.limit;
  const pageRows = hasMore ? allRows.slice(0, params.limit) : allRows;

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      handle: row.handle,
      profilePhotoUrl: row.profile_photo_url,
      followedAt: new Date(row.followed_at).toISOString(),
      relationship: deriveFollowRelationship({
        viewerId: params.viewerId,
        targetUserId: row.id,
        isFollowing: row.is_following,
        isFollowedBy: row.is_followed_by,
      }),
    })),
    pagination: {
      limit: params.limit,
      offset: params.offset,
      hasMore,
    },
  };
}

export async function listFollowers(
  viewerId: string,
  limit: number,
  offset: number,
): Promise<FollowListResponse> {
  return listFollowUsers({ mode: 'followers', viewerId, limit, offset });
}

export async function listFollowing(
  viewerId: string,
  limit: number,
  offset: number,
): Promise<FollowListResponse> {
  return listFollowUsers({ mode: 'following', viewerId, limit, offset });
}

export async function followUser(
  followerUserId: string,
  followedUserId: string,
): Promise<FollowRelationshipPayload> {
  if (followerUserId === followedUserId) {
    throw new Error('SELF_FOLLOW');
  }

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(userFollows)
      .values({
        followerUserId,
        followedUserId,
      })
      .onConflictDoNothing()
      .returning({
        followerUserId: userFollows.followerUserId,
      });

    if (inserted.length > 0) {
      await createNotification(
        {
          recipientUserId: followedUserId,
          actorUserId: followerUserId,
          eventType: 'new_follower',
          payload: {},
        },
        tx,
      );
    }
  });

  return getFollowRelationshipPayload(followedUserId, followerUserId);
}

export async function unfollowUser(
  followerUserId: string,
  followedUserId: string,
): Promise<FollowRelationshipPayload> {
  if (followerUserId === followedUserId) {
    throw new Error('SELF_FOLLOW');
  }

  await db
    .delete(userFollows)
    .where(
      and(
        eq(userFollows.followerUserId, followerUserId),
        eq(userFollows.followedUserId, followedUserId),
      ),
    );

  return getFollowRelationshipPayload(followedUserId, followerUserId);
}

export async function ensureUserExists(userId: string): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true },
  });

  return user != null;
}
