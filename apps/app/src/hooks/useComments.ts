/**
 * Comments Hooks
 * Provides data fetching and mutations for the comments system using TanStack Query
 */

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../utils/api';
import { useAuthContext } from '../providers/AuthProvider';

// Types
export interface CommentUser {
  id: string;
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
  karma: number;
}

export interface Comment {
  id: string;
  propertyId: string;
  userId: string;
  parentId: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  user: CommentUser;
  likeCount: number;
  replies: Comment[];
}

interface CommentListResponse {
  data: Comment[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type CommentSortBy = 'recent' | 'popular';

// Query keys for cache management
export const commentKeys = {
  all: ['comments'] as const,
  lists: () => [...commentKeys.all, 'list'] as const,
  list: (propertyId: string, sortBy: CommentSortBy) =>
    [...commentKeys.lists(), propertyId, sortBy] as const,
  detail: (commentId: string) => [...commentKeys.all, 'detail', commentId] as const,
};

// Fetch comments from API
async function fetchComments(
  propertyId: string,
  page: number = 1,
  limit: number = 20,
  sortBy: CommentSortBy = 'recent'
): Promise<CommentListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort: sortBy,
  });

  const response = await fetch(
    `${API_URL}/properties/${propertyId}/comments?${params.toString()}`
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to fetch comments' }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Hook to fetch comments for a property with infinite scrolling
 */
export function useComments(propertyId: string, sortBy: CommentSortBy = 'recent') {
  return useInfiniteQuery({
    queryKey: commentKeys.list(propertyId, sortBy),
    queryFn: ({ pageParam = 1 }) => fetchComments(propertyId, pageParam, 20, sortBy),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.meta;
      return page < totalPages ? page + 1 : undefined;
    },
    staleTime: 30 * 1000, // 30 seconds
    enabled: !!propertyId,
  });
}

/**
 * Hook to submit a new comment
 */
export function useSubmitComment(propertyId: string) {
  const queryClient = useQueryClient();
  const { accessToken, user } = useAuthContext();

  return useMutation({
    mutationFn: async ({
      content,
      parentId,
    }: {
      content: string;
      parentId?: string;
    }) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add user ID header (temporary until JWT auth is fully implemented)
      if (user?.id) {
        headers['x-user-id'] = user.id;
      }

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(`${API_URL}/properties/${propertyId}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content, parentId }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to submit comment' }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate all comment queries for this property to refetch
      queryClient.invalidateQueries({
        queryKey: commentKeys.lists(),
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === 'comments' && key[2] === propertyId;
        },
      });
    },
  });
}

/**
 * Hook to like/unlike a comment with optimistic updates
 */
export function useLikeComment(propertyId: string) {
  const queryClient = useQueryClient();
  const { accessToken, user } = useAuthContext();

  return useMutation({
    mutationFn: async ({
      commentId,
      isCurrentlyLiked,
    }: {
      commentId: string;
      isCurrentlyLiked: boolean;
    }) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (user?.id) {
        headers['x-user-id'] = user.id;
      }

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const method = isCurrentlyLiked ? 'DELETE' : 'POST';
      const response = await fetch(`${API_URL}/comments/${commentId}/like`, {
        method,
        headers,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to update like' }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }

      return response.json();
    },
    onMutate: async ({ commentId, isCurrentlyLiked }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: commentKeys.lists() });

      // Snapshot the previous values
      const previousData = queryClient.getQueriesData({ queryKey: commentKeys.lists() });

      // Optimistically update to the new value
      queryClient.setQueriesData(
        { queryKey: commentKeys.lists() },
        (old: { pages: { data: Comment[] }[] } | undefined) => {
          if (!old) return old;

          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((comment) => {
                // Check if this is the comment we're updating
                if (comment.id === commentId) {
                  return {
                    ...comment,
                    likeCount: isCurrentlyLiked
                      ? comment.likeCount - 1
                      : comment.likeCount + 1,
                  };
                }
                // Check replies
                if (comment.replies) {
                  return {
                    ...comment,
                    replies: comment.replies.map((reply) =>
                      reply.id === commentId
                        ? {
                            ...reply,
                            likeCount: isCurrentlyLiked
                              ? reply.likeCount - 1
                              : reply.likeCount + 1,
                          }
                        : reply
                    ),
                  };
                }
                return comment;
              }),
            })),
          };
        }
      );

      // Return context with the previous value for rollback
      return { previousData };
    },
    onError: (_err, _variables, context) => {
      // Rollback to previous state on error
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      // Always refetch after error or success to ensure we're in sync
      queryClient.invalidateQueries({
        queryKey: commentKeys.lists(),
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key[0] === 'comments' && key[2] === propertyId;
        },
      });
    },
  });
}

/**
 * Hook to check if a comment is liked by the current user
 * This is a simple fetch, not a query, since we track liked state locally
 */
export async function checkCommentLiked(
  commentId: string,
  userId?: string
): Promise<{ liked: boolean; likeCount: number }> {
  const headers: Record<string, string> = {};
  if (userId) {
    headers['x-user-id'] = userId;
  }

  const response = await fetch(`${API_URL}/comments/${commentId}/like`, {
    headers,
  });

  if (!response.ok) {
    return { liked: false, likeCount: 0 };
  }

  return response.json();
}
