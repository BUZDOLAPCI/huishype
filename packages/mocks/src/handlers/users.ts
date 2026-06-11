/**
 * User API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import type { FollowRelationship, UserSearchItem } from '@huishype/shared';
import {
  mockComments,
  mockGuesses,
  mockUserIds,
  mockUserIdentityState,
  mockUserProfiles,
  mockUsers,
  resetMockUserIdentityState,
} from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';

const DISPLAY_NAME_COOLDOWN_DAYS = 7;
const HANDLE_COOLDOWN_DAYS = 30;
const DISPLAY_NAME_MIN_LENGTH = 2;
const DISPLAY_NAME_MAX_LENGTH = 50;
const handlePattern = /^[a-z0-9_]{3,20}$/;

const karmaRankLevels: Record<string, number> = {
  Newcomer: 1,
  Contributor: 2,
  'Rising Star': 3,
  'Local Expert': 4,
  Expert: 5,
  'Local Legend': 6,
  Master: 7,
};

const initialFollowEdges = [
  `${mockUserIds.jan}:${mockUserIds.maria}`,
  `${mockUserIds.pieter}:${mockUserIds.jan}`,
  `${mockUserIds.jan}:${mockUserIds.lars}`,
  `${mockUserIds.lars}:${mockUserIds.jan}`,
];

let followEdges = new Set<string>(initialFollowEdges);

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

export function getFollowedUserIds(userId: string): string[] {
  return Array.from(followEdges)
    .map((edge) => edge.split(':'))
    .filter(([followerUserId]) => followerUserId === userId)
    .map(([, followedUserId]) => followedUserId);
}

export function isFollowingUser(followerUserId: string, followedUserId: string): boolean {
  return followEdges.has(followEdgeKey(followerUserId, followedUserId));
}

function mapKarmaRank(title: string) {
  return {
    title,
    level: karmaRankLevels[title] ?? 1,
  };
}

function getIdentityState(userId: string) {
  let state = mockUserIdentityState.get(userId);
  if (!state) {
    state = {
      lastDisplayNameChangeAt: null,
      lastUsernameChangeAt: null,
      homeCountry: null,
    };
    mockUserIdentityState.set(userId, state);
  }
  return state;
}

function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

function normalizeDisplayName(displayName: string) {
  return displayName.trim();
}

function visibleLength(value: string) {
  return Array.from(value).length;
}

function addDays(isoDate: string, days: number) {
  const date = new Date(isoDate);
  date.setDate(date.getDate() + days);
  return date;
}

function isoOrNull(date: Date | null) {
  return date ? date.toISOString() : null;
}

function availableAt(lastChangedAt: string | null, cooldownDays: number) {
  return lastChangedAt ? isoOrNull(addDays(lastChangedAt, cooldownDays)) : null;
}

function updateUserIdentity(
  userId: string,
  updates: {
    displayName?: string;
    username?: string;
    profilePhotoUrl?: string | null;
  }
) {
  const user = mockUsers.find((item) => item.id === userId);
  const profile = mockUserProfiles.find((item) => item.id === userId);
  const nextUpdates = updates.username
    ? { ...updates, handle: updates.username }
    : updates;

  if (user) {
    Object.assign(user, nextUpdates);
  }

  if (profile) {
    Object.assign(profile, nextUpdates);
  }
}

function buildPublicProfile(userId: string, viewerId: string | null) {
  const profile = mockUserProfiles.find((user) => user.id === userId);
  if (!profile) {
    return null;
  }

  const guessCount = mockGuesses.filter((guess) => guess.userId === userId).length;
  const commentCount = mockComments.reduce((count, comment) => {
    const topLevelCount = comment.userId === userId ? 1 : 0;
    const replyCount = comment.replies.filter((reply) => reply.userId === userId).length;
    return count + topLevelCount + replyCount;
  }, 0);

  return {
    id: profile.id,
    displayName: profile.displayName,
    handle: profile.handle,
    profilePhotoUrl: profile.profilePhotoUrl ?? null,
    homeCountry: getIdentityState(profile.id).homeCountry,
    karma: profile.karma,
    karmaRank: mapKarmaRank(profile.karmaRank),
    guessCount,
    commentCount,
    averageAccuracy: profile.averageAccuracy ?? null,
    joinedAt: profile.createdAt,
    followerCount: getFollowerCount(profile.id),
    followingCount: getFollowingCount(profile.id),
    relationship: getRelationship(viewerId, profile.id),
  };
}

function buildPublicProfileByHandle(handle: string, viewerId: string | null) {
  const normalizedHandle = normalizeHandle(handle);
  if (!handlePattern.test(normalizedHandle)) {
    return null;
  }

  const profile = mockUserProfiles.find(
    (user) => user.handle.toLowerCase() === normalizedHandle
  );

  return profile ? buildPublicProfile(profile.id, viewerId) : null;
}

function buildMyProfileResponse(userId: string) {
  const publicProfile = buildPublicProfile(userId, userId);
  if (!publicProfile) {
    return null;
  }

  return {
    ...publicProfile,
    email: `${publicProfile.handle}@example.com`,
    hasDisplayName: true,
    averageAccuracy: mockUserProfiles.find((user) => user.id === userId)?.averageAccuracy ?? null,
    savedCount: 4,
    likedCount: 7,
    lastDisplayNameChangeAt: getIdentityState(userId).lastDisplayNameChangeAt,
    lastHandleChangeAt: getIdentityState(userId).lastUsernameChangeAt,
    displayNameChangeAvailableAt: availableAt(
      getIdentityState(userId).lastDisplayNameChangeAt,
      DISPLAY_NAME_COOLDOWN_DAYS
    ),
    handleChangeAvailableAt: availableAt(
      getIdentityState(userId).lastUsernameChangeAt,
      HANDLE_COOLDOWN_DAYS
    ),
    lastNameChangeAt: getIdentityState(userId).lastDisplayNameChangeAt,
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
        handle: profile.handle,
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

function normalizeSearchQuery(query: string | null) {
  return (query ?? '').trim().replace(/^@+/, '').toLowerCase();
}

function rankSearchMatch(profile: (typeof mockUserProfiles)[number], query: string) {
  const username = profile.handle.toLowerCase();
  const displayName = profile.displayName.toLowerCase();

  if (username === query) {
    return 0;
  }
  if (username.startsWith(query)) {
    return 1;
  }
  if (displayName.startsWith(query)) {
    return 2;
  }
  if (username.includes(query) || displayName.includes(query)) {
    return 3;
  }
  return null;
}

function searchUsers(request: Request) {
  const url = new URL(request.url);
  const query = normalizeSearchQuery(url.searchParams.get('q'));
  const { limit, offset } = parsePagination(request);
  const viewerId = getMockAuthUser(request.headers.get('Authorization'))?.id ?? null;

  if (query.length < 2) {
    return HttpResponse.json(
      { error: 'QUERY_TOO_SHORT', message: 'Search query must be at least 2 characters.' },
      { status: 400 }
    );
  }

  const rankedUsers = mockUserProfiles
    .map((profile) => {
      const rank = rankSearchMatch(profile, query);
      return rank === null ? null : { profile, rank };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }

      const followerCountDelta =
        getFollowerCount(right.profile.id) - getFollowerCount(left.profile.id);
      if (followerCountDelta !== 0) {
        return followerCountDelta;
      }

      return left.profile.handle.localeCompare(right.profile.handle);
    });

  const items: UserSearchItem[] = rankedUsers
    .slice(offset, offset + limit)
    .map(({ profile }) => ({
      id: profile.id,
      displayName: profile.displayName,
      handle: profile.handle,
      profilePhotoUrl: profile.profilePhotoUrl ?? null,
      relationship: getRelationship(viewerId, profile.id),
      followerCount: getFollowerCount(profile.id),
    }));

  return HttpResponse.json({
    items,
    pagination: {
      limit,
      offset,
      hasMore: offset + limit < rankedUsers.length,
    },
  });
}

function buildProfileIdentityResponse(userId: string) {
  const identityState = getIdentityState(userId);
  const updatedProfile = mockUserProfiles.find((profile) => profile.id === userId);

  if (!updatedProfile) {
    return null;
  }

  return {
    id: userId,
    displayName: updatedProfile.displayName,
    handle: updatedProfile.handle,
    profilePhotoUrl: updatedProfile.profilePhotoUrl ?? null,
    homeCountry: identityState.homeCountry,
    lastDisplayNameChangeAt: identityState.lastDisplayNameChangeAt,
    lastHandleChangeAt: identityState.lastUsernameChangeAt,
    displayNameChangeAvailableAt: availableAt(
      identityState.lastDisplayNameChangeAt,
      DISPLAY_NAME_COOLDOWN_DAYS
    ),
    handleChangeAvailableAt: availableAt(identityState.lastUsernameChangeAt, HANDLE_COOLDOWN_DAYS),
    lastNameChangeAt: identityState.lastDisplayNameChangeAt,
  };
}

export const userHandlers = [
  http.get('*/users/search', ({ request }) => searchUsers(request)),

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
      displayName?: unknown;
      handle?: unknown;
      profilePhotoUrl?: unknown;
      homeCountry?: unknown;
    };
    const identityState = getIdentityState(authUser.id);
    const identityUpdates: {
      displayName?: string;
      username?: string;
      profilePhotoUrl?: string;
    } = {};
    let nextDisplayNameChangeAt = identityState.lastDisplayNameChangeAt;
    let nextUsernameChangeAt = identityState.lastUsernameChangeAt;

    if (body.displayName !== undefined) {
      if (typeof body.displayName !== 'string') {
        return HttpResponse.json(
          { error: 'VALIDATION_ERROR', message: 'Display name must be a string.' },
          { status: 400 }
        );
      }

      const displayName = normalizeDisplayName(body.displayName);
      const length = visibleLength(displayName);

      if (length < DISPLAY_NAME_MIN_LENGTH || length > DISPLAY_NAME_MAX_LENGTH) {
        return HttpResponse.json(
          {
            error: 'VALIDATION_ERROR',
            message: `Display name must be between ${DISPLAY_NAME_MIN_LENGTH} and ${DISPLAY_NAME_MAX_LENGTH} characters.`,
          },
          { status: 400 }
        );
      }

      if (displayName !== authUser.displayName) {
        if (identityState.lastDisplayNameChangeAt) {
          const cooldownEnd = addDays(
            identityState.lastDisplayNameChangeAt,
            DISPLAY_NAME_COOLDOWN_DAYS
          );

          if (new Date() < cooldownEnd) {
            const nextAvailableAt = cooldownEnd.toISOString();
            return HttpResponse.json(
              {
                error: 'DISPLAY_NAME_COOLDOWN',
                message: `Display name can only be changed once every ${DISPLAY_NAME_COOLDOWN_DAYS} days.`,
                nextAvailableAt,
              },
              { status: 429 }
            );
          }
        }

        identityUpdates.displayName = displayName;
        nextDisplayNameChangeAt = new Date().toISOString();
      }
    }

    if (body.handle !== undefined) {
      if (typeof body.handle !== 'string') {
        return HttpResponse.json(
          { error: 'VALIDATION_ERROR', message: 'Handle must be a string.' },
          { status: 400 }
        );
      }

      const handle = normalizeHandle(body.handle);

      if (!handlePattern.test(handle)) {
        return HttpResponse.json(
          {
            error: 'VALIDATION_ERROR',
            message: 'Handle must be 3-20 characters and use only letters, numbers, and underscores.',
          },
          { status: 400 }
        );
      }

      if (handle !== authUser.handle) {
        const duplicate = mockUserProfiles.some(
          (profile) => profile.id !== authUser.id && profile.handle.toLowerCase() === handle
        );

        if (duplicate) {
          return HttpResponse.json(
            { error: 'HANDLE_TAKEN', message: 'Handle is already taken.' },
            { status: 409 }
          );
        }

        if (identityState.lastUsernameChangeAt) {
          const cooldownEnd = addDays(identityState.lastUsernameChangeAt, HANDLE_COOLDOWN_DAYS);

          if (new Date() < cooldownEnd) {
            const nextAvailableAt = cooldownEnd.toISOString();
            return HttpResponse.json(
              {
                error: 'HANDLE_COOLDOWN',
                message: `Handle can only be changed once every ${HANDLE_COOLDOWN_DAYS} days.`,
                nextAvailableAt,
              },
              { status: 429 }
            );
          }
        }

        identityUpdates.username = handle;
        nextUsernameChangeAt = new Date().toISOString();
      }
    }

    if (body.profilePhotoUrl !== undefined) {
      if (typeof body.profilePhotoUrl !== 'string') {
        return HttpResponse.json(
          { error: 'VALIDATION_ERROR', message: 'Profile photo URL must be a string.' },
          { status: 400 }
        );
      }

      identityUpdates.profilePhotoUrl = body.profilePhotoUrl;
    }

    if (body.homeCountry !== undefined) {
      identityState.homeCountry =
        typeof body.homeCountry === 'string' ? body.homeCountry.toUpperCase() : null;
    }

    updateUserIdentity(authUser.id, identityUpdates);
    identityState.lastDisplayNameChangeAt = nextDisplayNameChangeAt;
    identityState.lastUsernameChangeAt = nextUsernameChangeAt;

    return HttpResponse.json(buildProfileIdentityResponse(authUser.id));
  }),

  http.post('*/users/me/profile-photo', async ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as { imageBase64?: unknown; mimeType?: unknown };
    if (typeof body.imageBase64 !== 'string' || body.imageBase64.length === 0) {
      return HttpResponse.json(
        { error: 'VALIDATION_ERROR', message: 'Profile photo image data is required.' },
        { status: 400 }
      );
    }

    updateUserIdentity(authUser.id, {
      profilePhotoUrl: `https://media.huishype.test/profile-photos/${authUser.id}/mock-avatar.jpg`,
    });

    return HttpResponse.json(buildProfileIdentityResponse(authUser.id));
  }),

  http.delete('*/users/me/profile-photo', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { error: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    updateUserIdentity(authUser.id, {
      profilePhotoUrl: null,
    });

    return HttpResponse.json(buildProfileIdentityResponse(authUser.id));
  }),

  http.get('*/users/by-handle/:handle/profile', ({ params, request }) => {
    const viewerId = getMockAuthUser(request.headers.get('Authorization'))?.id ?? null;
    const { handle } = params;
    const profile = buildPublicProfileByHandle(String(handle), viewerId);

    if (!profile) {
      return HttpResponse.json({ error: 'NOT_FOUND', message: 'User not found' }, { status: 404 });
    }

    return HttpResponse.json(profile);
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

export function resetMockFollowState() {
  followEdges = new Set(initialFollowEdges);
}

export function resetMockUserState() {
  resetMockFollowState();
  resetMockUserIdentityState();
}
