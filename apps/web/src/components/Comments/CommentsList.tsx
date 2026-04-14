import { useCallback, useMemo, useState } from 'react';
import { Comment, type CommentData } from './Comment';
import { CommentInput } from '../CommentInput';
import {
  useComments,
  useSubmitComment,
  useLikeComment,
  type CommentSortBy,
} from '../../hooks/useComments';
import { useAuthContext } from '../../providers/AuthProvider';
import { Icon } from '../ui/Icon';

export interface CommentsListProps {
  propertyId: string;
  onAuthRequired?: () => void;
}

function findCommentById(comments: CommentData[], commentId: string): CommentData | null {
  for (const comment of comments) {
    if (comment.id === commentId) {
      return comment;
    }

    const reply = comment.replies?.length
      ? findCommentById(comment.replies, commentId)
      : null;

    if (reply) {
      return reply;
    }
  }

  return null;
}

export function CommentsList({ propertyId, onAuthRequired }: CommentsListProps) {
  const [sortBy, setSortBy] = useState<CommentSortBy>('recent');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);

  const { isAuthenticated } = useAuthContext();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useComments(propertyId, sortBy);

  const submitMutation = useSubmitComment(propertyId);
  const likeMutation = useLikeComment(propertyId);

  const comments = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.data);
  }, [data?.pages]);

  const totalComments = data?.pages[0]?.meta.total ?? 0;

  const handleLike = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.();
        return;
      }

      const targetComment = findCommentById(comments, commentId);
      likeMutation.mutate({
        commentId,
        isCurrentlyLiked: targetComment?.isLiked ?? false,
      });
    },
    [comments, isAuthenticated, likeMutation, onAuthRequired],
  );

  const handleReply = useCallback(
    (commentId: string, username: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.();
        return;
      }

      setReplyTo({ id: commentId, username });
    },
    [isAuthenticated, onAuthRequired],
  );

  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  const handleSubmit = useCallback(
    (content: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.();
        return;
      }

      submitMutation.mutate(
        { content, parentId: replyTo?.id },
        {
          onSuccess: () => {
            setReplyTo(null);
          },
        },
      );
    },
    [isAuthenticated, onAuthRequired, replyTo?.id, submitMutation],
  );

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const renderHeader = useCallback(
    () => (
      <div className="flex items-center justify-between border-b border-warm-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon name="ChatCircle" size={20} color="#F5A623" />
          <h2 className="text-lg font-semibold text-warm-900">Comments</h2>
          {totalComments > 0 && (
            <span className="rounded-full bg-warm-100 px-2 py-0.5 text-xs text-warm-600">
              {totalComments}
            </span>
          )}
        </div>

        <div className="flex items-center rounded-lg bg-warm-100 p-0.5">
          <button
            type="button"
            onClick={() => setSortBy('recent')}
            className={`rounded-md px-3 py-1.5 text-sm ${
              sortBy === 'recent' ? 'bg-surface-card text-warm-900 shadow-sm' : 'text-warm-500'
            }`}
            data-testid="sort-recent"
          >
            Recent
          </button>
          <button
            type="button"
            onClick={() => setSortBy('popular')}
            className={`rounded-md px-3 py-1.5 text-sm ${
              sortBy === 'popular' ? 'bg-surface-card text-warm-900 shadow-sm' : 'text-warm-500'
            }`}
            data-testid="sort-popular"
          >
            Popular
          </button>
        </div>
      </div>
    ),
    [sortBy, totalComments],
  );

  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
        <Icon name="WarningCircle" size={48} color="#EF4444" />
        <h3 className="mt-3 text-base text-warm-700">Failed to load comments</h3>
        <p className="mt-1 text-sm text-warm-500">{error?.message || 'Please try again'}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-4 rounded-lg bg-primary-500 px-4 py-2 text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col bg-surface-card">
        {renderHeader()}
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-r-transparent text-primary-500" />
          <span className="sr-only">Loading comments</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-card">
      {renderHeader()}

      <div
        className="flex-1 overflow-y-auto px-4 pb-24"
        data-testid="comments-list"
        onScroll={(event) => {
          const target = event.currentTarget;
          if (target.scrollTop + target.clientHeight >= target.scrollHeight - 200) {
            handleLoadMore();
          }
        }}
      >
        {comments.length === 0 ? (
          <div className="py-12 text-center">
            <Icon name="ChatCircle" size={48} color="#E8E0D4" />
            <p className="mt-3 text-base text-warm-500">No comments yet</p>
            <p className="mt-1 text-sm text-warm-400">Be the first to share your thoughts!</p>
          </div>
        ) : (
          comments.map((item, index) => (
            <div key={item.id}>
              <Comment
                comment={item}
                onLike={handleLike}
                onReply={handleReply}
                isLiked={item.isLiked}
              />
              {index < comments.length - 1 ? <div className="h-px bg-warm-100" /> : null}
            </div>
          ))
        )}

        {isFetchingNextPage ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent text-primary-500" />
          </div>
        ) : null}

        {isRefetching ? (
          <div className="sr-only" aria-live="polite">
            Refreshing comments
          </div>
        ) : null}
      </div>

      <div className="border-t border-warm-100 bg-surface-card">
        <CommentInput
          onSubmit={handleSubmit}
          replyTo={replyTo}
          onCancelReply={handleCancelReply}
          isAuthenticated={isAuthenticated}
          variant="full"
        />
      </div>
    </div>
  );
}
