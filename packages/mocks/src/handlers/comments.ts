/**
 * Comment API mock handlers
 *
 * Paths match the live Fastify routes (no /api/v1 prefix).
 * See services/api/openapi.json for canonical paths.
 */

import { http, HttpResponse } from 'msw';
import { mockComments, getMockProperty } from '../data/fixtures.js';
import { getMockAuthUser } from './auth.js';
import type {
  GetCommentsResponse,
  CreateCommentResponse,
  Comment,
  CommentWithReplies,
} from '@huishype/shared';

// In-memory store for new comments during mock session
const sessionComments: CommentWithReplies[] = [];

export const commentHandlers = [
  /**
   * GET /properties/:id/comments - Get comments for a property
   */
  http.get('/properties/:propertyId/comments', ({ params, request }) => {
    const { propertyId } = params;
    const url = new URL(request.url);
    const sort = url.searchParams.get('sort') || 'popular_recent';
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const cursor = url.searchParams.get('cursor');

    const property = getMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    let comments = [...mockComments, ...sessionComments].filter(
      (c) => c.propertyId === propertyId && !c.parentId
    );

    switch (sort) {
      case 'newest':
        comments.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        break;
      case 'oldest':
        comments.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        break;
      case 'most_liked':
        comments.sort((a, b) => b.likes - a.likes);
        break;
      case 'popular_recent':
      default:
        comments.sort((a, b) => {
          const recencyA = new Date(a.createdAt).getTime();
          const recencyB = new Date(b.createdAt).getTime();
          const scoreA = a.likes * 1000 + recencyA / 1000000;
          const scoreB = b.likes * 1000 + recencyB / 1000000;
          return scoreB - scoreA;
        });
    }

    if (cursor) {
      const cursorIndex = comments.findIndex((c) => c.id === cursor);
      if (cursorIndex !== -1) {
        comments = comments.slice(cursorIndex + 1);
      }
    }

    const hasMore = comments.length > limit;
    comments = comments.slice(0, limit);

    const allComments = [...mockComments, ...sessionComments].filter(
      (c) => c.propertyId === propertyId
    );

    const response: GetCommentsResponse = {
      thread: {
        totalCount: allComments.length,
        comments,
        hasMore,
        nextCursor: hasMore ? comments[comments.length - 1]?.id : undefined,
      },
    };

    return HttpResponse.json(response);
  }),

  /**
   * POST /properties/:id/comments - Create a comment
   */
  http.post('/properties/:propertyId/comments', async ({ params, request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));

    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { propertyId } = params;
    const body = await request.json() as { content: string; parentId?: string };
    const { content, parentId } = body;

    const property = getMockProperty(propertyId as string);
    if (!property) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Property not found' },
        { status: 404 }
      );
    }

    if (!content || content.trim().length === 0) {
      return HttpResponse.json(
        { code: 'INVALID_CONTENT', message: 'Comment cannot be empty' },
        { status: 400 }
      );
    }

    if (content.length > 500) {
      return HttpResponse.json(
        { code: 'CONTENT_TOO_LONG', message: 'Comment must be at most 500 characters' },
        { status: 400 }
      );
    }

    let mentionedUser: { id: string; username: string } | undefined;
    if (parentId) {
      const parentComment = [...mockComments, ...sessionComments].find(
        (c) => c.id === parentId
      );
      if (!parentComment) {
        return HttpResponse.json(
          { code: 'PARENT_NOT_FOUND', message: 'Parent comment not found' },
          { status: 404 }
        );
      }
      if (parentComment.parentId) {
        return HttpResponse.json(
          { code: 'NESTED_REPLY', message: 'Cannot reply to a reply' },
          { status: 400 }
        );
      }
      mentionedUser = {
        id: parentComment.userId,
        username: parentComment.user.username,
      };
    }

    const newComment: Comment = {
      id: `comment-${Date.now()}`,
      propertyId: propertyId as string,
      userId: authUser.id,
      user: {
        id: authUser.id,
        username: authUser.username,
        displayName: authUser.displayName,
        profilePhotoUrl: authUser.profilePhotoUrl,
        karma: authUser.karma,
        karmaRank: authUser.karmaRank,
      },
      parentId,
      mentionedUser,
      content: content.trim(),
      likes: 0,
      isLikedByCurrentUser: false,
      createdAt: new Date().toISOString(),
      isEdited: false,
      replyCount: 0,
    };

    if (!parentId) {
      sessionComments.push({ ...newComment, replies: [] });
    }

    const response: CreateCommentResponse = {
      comment: newComment,
    };

    return HttpResponse.json(response, { status: 201 });
  }),

  /**
   * POST /comments/:id/like - Like a comment
   */
  http.post('/comments/:commentId/like', ({ params, request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const { commentId } = params;
    const comment =
      mockComments.find((c) => c.id === commentId) ||
      mockComments.flatMap((c) => c.replies).find((c) => c.id === commentId) ||
      sessionComments.find((c) => c.id === commentId);

    if (!comment) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'Comment not found' },
        { status: 404 }
      );
    }

    const isLiked = !comment.isLikedByCurrentUser;
    const likeCount = isLiked ? comment.likes + 1 : comment.likes - 1;

    return HttpResponse.json({
      isLiked,
      likeCount: Math.max(0, likeCount),
    });
  }),

  /**
   * DELETE /comments/:id/like - Unlike a comment
   */
  http.delete('/comments/:commentId/like', ({ request }) => {
    const authUser = getMockAuthUser(request.headers.get('Authorization'));
    if (!authUser) {
      return HttpResponse.json(
        { code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }

    return new HttpResponse(null, { status: 204 });
  }),
];
