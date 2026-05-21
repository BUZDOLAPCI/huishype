/**
 * Comments Hooks
 * Provides data fetching and mutations for the comments system using TanStack Query
 */

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
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
  isLiked: boolean;
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
  commentsDisabled?: boolean;
}

export type CommentSortBy = 'recent' | 'popular';

// Query keys for cache management
export const commentKeys = {
  all: ['comments'] as const,
  lists: () => [...commentKeys.all, 'list'] as const,
  list: (propertyId: string, sortBy: CommentSortBy, viewerKey: string) =>
    [...commentKeys.lists(), propertyId, sortBy, viewerKey] as const,
  detail: (commentId: string) => [...commentKeys.all, 'detail', commentId] as const,
};

type CommentListQueryData = InfiniteData<CommentListResponse>;
type CommentLikeState = Pick<Comment, 'isLiked' | 'likeCount'>;
type LikeStatusResponse = { liked: boolean; likeCount: number };

function getCommentQueryFilter(propertyId: string, viewerKey?: string) {
  return {
    queryKey: commentKeys.lists(),
    predicate: (query: { queryKey: readonly unknown[] }) => {
      const key = query.queryKey;
      return (
        Array.isArray(key) &&
        key[0] === 'comments' &&
        key[1] === 'list' &&
        key[2] === propertyId &&
        (viewerKey === undefined || key[4] === viewerKey)
      );
    },
  };
}

function updateCommentCollection(
  comments: Comment[],
  commentId: string,
  updater: (comment: Comment) => Comment
): Comment[] {
  return comments.map((comment) => {
    if (comment.id === commentId) {
      return updater(comment);
    }

    if (comment.replies.length === 0) {
      return comment;
    }

    return {
      ...comment,
      replies: updateCommentCollection(comment.replies, commentId, updater),
    };
  });
}

function updateCommentLikeState(
  queryClient: ReturnType<typeof useQueryClient>,
  propertyId: string,
  viewerKey: string,
  commentId: string,
  updater: (comment: Comment) => CommentLikeState
) {
  queryClient.setQueriesData<CommentListQueryData>(
    getCommentQueryFilter(propertyId, viewerKey),
    (old) => {
      if (!old) {
        return old;
      }

      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          data: updateCommentCollection(page.data, commentId, (comment) => {
            const nextState = updater(comment);
            return {
              ...comment,
              isLiked: nextState.isLiked,
              likeCount: Math.max(0, nextState.likeCount),
            };
          }),
        })),
      };
    }
  );
}

function applyAuthoritativeCommentLikeState(
  queryClient: ReturnType<typeof useQueryClient>,
  propertyId: string,
  viewerKey: string,
  commentId: string,
  nextState: LikeStatusResponse | CommentLikeState
) {
  updateCommentLikeState(queryClient, propertyId, viewerKey, commentId, () => ({
    isLiked: 'isLiked' in nextState ? nextState.isLiked : nextState.liked,
    likeCount: nextState.likeCount,
  }));
}

// Fetch comments from API
async function fetchComments(
  propertyId: string,
  page: number = 1,
  limit: number = 20,
  sortBy: CommentSortBy = 'recent',
  accessToken?: string
): Promise<CommentListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort: sortBy,
  });

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_URL}/properties/${propertyId}/comments?${params.toString()}`, {
    headers,
  });

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
  const { accessToken, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anonymous';

  return useInfiniteQuery({
    queryKey: commentKeys.list(propertyId, sortBy, viewerKey),
    queryFn: ({ pageParam = 1 }) =>
      fetchComments(propertyId, pageParam, 20, sortBy, accessToken ?? undefined),
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
  const { accessToken } = useAuthContext();

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
      queryClient.invalidateQueries(getCommentQueryFilter(propertyId));
    },
  });
}

/**
 * Hook to like/unlike a comment with optimistic updates
 */
export function useLikeComment(propertyId: string) {
  const queryClient = useQueryClient();
  const { accessToken, user } = useAuthContext();
  const viewerKey = user?.id ?? 'anonymous';

  return useMutation({
    mutationFn: async ({
      commentId,
      isCurrentlyLiked,
    }: {
      commentId: string;
      isCurrentlyLiked: boolean;
    }) => {
      const headers: Record<string, string> = {};

      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const method = isCurrentlyLiked ? 'DELETE' : 'POST';
      const response = await fetch(`${API_URL}/comments/${commentId}/like`, {
        method,
        headers,
      });

      if (!response.ok) {
        if (
          (response.status === 409 && !isCurrentlyLiked) ||
          (response.status === 404 && isCurrentlyLiked)
        ) {
          return checkCommentLiked(commentId, accessToken ?? undefined);
        }

        const error = await response.json().catch(() => ({ message: 'Failed to update like' }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
      }

      return response.json();
    },
    onMutate: async ({ commentId, isCurrentlyLiked }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries(getCommentQueryFilter(propertyId, viewerKey));

      // Snapshot the previous values
      const previousData = queryClient.getQueriesData<CommentListQueryData>(
        getCommentQueryFilter(propertyId, viewerKey)
      );

      // Optimistically update to the new value
      updateCommentLikeState(
        queryClient,
        propertyId,
        viewerKey,
        commentId,
        (comment) => ({
          isLiked: !isCurrentlyLiked,
          likeCount: comment.likeCount + (isCurrentlyLiked ? -1 : 1),
        })
      );

      // Return context with the previous value for rollback
      return { previousData };
    },
    onSuccess: (data, variables) => {
      applyAuthoritativeCommentLikeState(queryClient, propertyId, viewerKey, variables.commentId, data);
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
      queryClient.invalidateQueries(getCommentQueryFilter(propertyId));
    },
  });
}

/**
 * Fetch the authoritative like state for a single comment.
 * Used to reconcile stale client state after idempotent 409/404 like conflicts.
 */
export async function checkCommentLiked(
  commentId: string,
  accessToken?: string
): Promise<{ liked: boolean; likeCount: number }> {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_URL}/comments/${commentId}/like`, {
    headers,
  });

  if (!response.ok) {
    return { liked: false, likeCount: 0 };
  }

  return response.json();
}
