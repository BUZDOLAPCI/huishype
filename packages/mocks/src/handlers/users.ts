/**
 * User API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { mockUserProfiles, mockGuesses } from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';

type FollowRelationship = 'self' | 'none' | 'following' | 'followed_by' | 'mutual';

const karmaRankLevels: Record<string, number> = {
  Newcomer: 1,
  Contributor: 2,
  'Rising Star': 3,
  'Local Expert': 4,
  Expert: 5,
  'Local Legend': 6,
  Master: 7,
};

const followEdges = new Set<string>([
  'user-001:user-002',
  'user-003:user-001',
  'user-001:user-007',
  'user-007:user-001',
]);

function followEdgeKey(followerUserId: string, followedUserId: string) {
  return `${followerUserId}:${followedUserId}`;
}

function getFollowerCount(userId: string) {
  return Array.from(followEdges).filter((edge) => edge.endsWith(`:${userId}`)).length;
}

function getFollowingCount(userId: string) {
  return Array.from(followEdges).filter((edge) => edge.startsWith(`${userId}:`)).length;
}

function getRelationship(viewerId: string | null, targetUserId: string): FollowRelationship {
  if (viewerId === targetUserId) {
    return 'self';
  }

  if (!viewerId) {
    return 'none';
  }

  const isFollowing = followEdges.has(followEdgeKey(viewerId, targetUserId));
  const isFollowedBy = followEdges.has(followEdgeKey(targetUserId, viewerId));

  if (isFollowing && isFollowedBy) {
    return 'mutual';
  }

  if (isFollowing) {
    return 'following';
  }

  if (isFollowedBy) {
    return 'followed_by';
  }

  return 'none';
}

function mapKarmaRank(title: string) {
  return {
    title,
    level: karmaRankLevels[title] ?? 1,
  };
}

function buildPublicProfile(userId: string, viewerId: string | null) {
  const profile = mockUserProfiles.find((user) => user.id === userId);
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    displayName: profile.displayName,
    handle: profile.username,
    profilePhotoUrl: profile.profilePhotoUrl ?? null,
    homeCountry: null,
    karma: profile.karma,
    karmaRank: mapKarmaRank(profile.karmaRank),
    guessCount: profile.totalGuesses,
    commentCount: Math.max(0, profile.totalGuesses - profile.resolvedGuesses),
    joinedAt: profile.createdAt,
    followerCount: getFollowerCount(profile.id),
    followingCount: getFollowingCount(profile.id),
    relationship: getRelationship(viewerId, profile.id),
  };
}

function buildMyProfileResponse(userId: string) {
  const publicProfile = buildPublicProfile(userId, userId);
  if (!publicProfile) {
    return null;
  }

  return {
    ...publicProfile,
    email: `${publicProfile.handle}@example.com`,
    averageAccuracy: mockUserProfiles.find((user) => user.id === userId)?.averageAccuracy ?? null,
    savedCount: 4,
    likedCount: 7,
    lastNameChangeAt: '2026-03-01T10:00:00.000Z',
  };
}

function listFollowUsers(
  viewerId: string,
  mode: 'followers' | 'following',
  limit: number,
  offset: number
) {
  const userIds = Array.from(followEdges)
    .map((edge) => edge.split(':'))
    .filter(([followerUserId, followedUserId]) =>
      mode === 'followers' ? followedUserId === viewerId : followerUserId === viewerId
    )
    .map(([followerUserId, followedUserId]) =>
      mode === 'followers' ? followerUserId : followedUserId
    )
    .reverse();

  const items = userIds
    .slice(offset, offset + limit)
    .map((userId, index) => {
      const profile = mockUserProfiles.find((user) => user.id === userId);
      if (!profile) {
        return null;
      }

      return {
        id: profile.id,
        displayName: profile.displayName,
        handle: profile.username,
        profilePhotoUrl: profile.profilePhotoUrl ?? null,
        followedAt: new Date(Date.parse('2026-04-18T09:00:00.000Z') - index * 60_000).toISOString(),
        relationship: getRelationship(viewerId, profile.id),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    items,
    pagination: {
      limit,
      offset,
      hasMore: offset + limit < userIds.length,
    },
  };
}

function parsePagination(request: Request) {
  const url = new URL(request.url);
  return {
    limit: parseInt(url.searchParams.get('limit') || '20', 10),
    offset: parseInt(url.searchParams.get('offset') || '0', 10),
  };
}

export const userHandlers = [
  http.get(/.*\/users\/me$/, ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    return HttpResponse.json(buildMyProfileResponse(authUser.id));
  }),

  http.put('*/users/me/profile', async ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      displayName?: string;
      profilePhotoUrl?: string;
      homeCountry?: string | null;
    };

    return HttpResponse.json({
      id: authUser.id,
      displayName: body.displayName ?? authUser.displayName,
      profilePhotoUrl: body.profilePhotoUrl ?? authUser.profilePhotoUrl ?? null,
      homeCountry: body.homeCountry ?? null,
      lastNameChangeAt: new Date().toISOString(),
    });
  }),

  http.get('*/users/:userId/profile', ({ params, request }) => {
    const viewerId = getMockAuthUser(request.headers.get('Authorization'))?.id ?? null;
    const { userId } = params;
    const profile = buildPublicProfile(String(userId), viewerId);

    if (!profile) {
      return HttpResponse.json({ error: 'NOT_FOUND', message: 'User not found' }, { status: 404 });
    }

    return HttpResponse.json(profile);
  }),

  http.get('*/users/me/followers', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { limit, offset } = parsePagination(request);
    return HttpResponse.json(listFollowUsers(authUser.id, 'followers', limit, offset));
  }),

  http.get('*/users/me/following', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { limit, offset } = parsePagination(request);
    return HttpResponse.json(listFollowUsers(authUser.id, 'following', limit, offset));
  }),

  http.put('*/users/:userId/follow', ({ params, request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const targetUserId = String(params.userId);
    if (targetUserId === authUser.id) {
      return HttpResponse.json(
        { error: 'SELF_FOLLOW', message: 'You cannot follow yourself.' },
        { status: 400 }
      );
    }

    if (!mockUserProfiles.some((user) => user.id === targetUserId)) {
      return HttpResponse.json(
        { error: 'USER_NOT_FOUND', message: 'User not found' },
        { status: 404 }
      );
    }

    followEdges.add(followEdgeKey(authUser.id, targetUserId));

    return HttpResponse.json({
      relationship: getRelationship(authUser.id, targetUserId),
      followerCount: getFollowerCount(targetUserId),
      followingCount: getFollowingCount(targetUserId),
    });
  }),

  http.delete('*/users/:userId/follow', ({ params, request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const targetUserId = String(params.userId);
    if (targetUserId === authUser.id) {
      return HttpResponse.json(
        { error: 'SELF_FOLLOW', message: 'You cannot unfollow yourself.' },
        { status: 400 }
      );
    }

    if (!mockUserProfiles.some((user) => user.id === targetUserId)) {
      return HttpResponse.json(
        { error: 'USER_NOT_FOUND', message: 'User not found' },
        { status: 404 }
      );
    }

    followEdges.delete(followEdgeKey(authUser.id, targetUserId));

    return HttpResponse.json({
      relationship: getRelationship(authUser.id, targetUserId),
      followerCount: getFollowerCount(targetUserId),
      followingCount: getFollowingCount(targetUserId),
    });
  }),

  http.get('*/users/me/guesses', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const cursor = url.searchParams.get('cursor');

    let guesses = mockGuesses
      .filter((guess) => guess.userId === authUser.id)
      .sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );

    if (cursor) {
      const cursorIndex = guesses.findIndex((guess) => guess.id === cursor);
      if (cursorIndex !== -1) {
        guesses = guesses.slice(cursorIndex + 1);
      }
    }

    const hasMore = guesses.length > limit;
    guesses = guesses.slice(0, limit);

    return HttpResponse.json({
      data: guesses,
      cursor: hasMore ? guesses[guesses.length - 1]?.id : undefined,
      hasMore,
    });
  }),
];
