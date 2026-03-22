/**
 * User API mock handlers
 *
 * Paths match the live Fastify routes.
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { mockUserProfiles, mockGuesses } from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';

export const userHandlers = [
  /**
   * GET /users/me - Get current user
   */
  http.get('/users/me', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }
    return HttpResponse.json(authUser);
  }),

  /**
   * PUT /users/me/profile - Update current user profile
   */
  http.put('/users/me/profile', async ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json() as { displayName?: string };

    return HttpResponse.json({
      ...authUser,
      ...(body.displayName ? { displayName: body.displayName } : {}),
    });
  }),

  /**
   * GET /users/:id/profile - Get user profile by ID
   */
  http.get('/users/:userId/profile', ({ params }) => {
    const { userId } = params;
    const profile = mockUserProfiles.find((u) => u.id === userId);

    if (!profile) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'User not found' },
        { status: 404 }
      );
    }

    return HttpResponse.json(profile);
  }),

  /**
   * GET /users/me/guesses - Get current user's guess history
   */
  http.get('/users/me/guesses', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const cursor = url.searchParams.get('cursor');

    let guesses = mockGuesses
      .filter((g) => g.userId === authUser.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (cursor) {
      const cursorIndex = guesses.findIndex((g) => g.id === cursor);
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
