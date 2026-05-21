import { useEffect, useState, useCallback, useMemo } from 'react';
import { Pressable, Text, View, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SectionProps } from './types';
import { Comment, CommentInput } from '../Comments';
import { useComments, useSubmitComment, useLikeComment, type CommentSortBy } from '../../hooks/useComments';
import { useAuthContext } from '../../providers/AuthProvider';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';
import { SectionCard } from './SectionCard';
import { ReportModal } from '../ReportModal';

interface CommentsSectionProps extends SectionProps {
  onViewAll?: () => void;
  onAuthRequired?: (copy?: AuthModalCopyInput) => void;
}

const COMMENT_AUTH_REQUIRED_COPY = 'Sign in to post your comment' satisfies AuthModalCopyInput;

/**
 * CommentsSection Component
 * Displays comments within the PropertyBottomSheet with full interaction support
 */
export function CommentsSection({
  property,
  onViewAll,
  onAuthRequired,
}: CommentsSectionProps) {
  const [sortBy, setSortBy] = useState<CommentSortBy>('recent');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [showAllComments, setShowAllComments] = useState(false);
  const [pendingSubmitAfterAuth, setPendingSubmitAfterAuth] = useState<{
    content: string;
    parentId?: string;
  } | null>(null);
  const [reportCommentId, setReportCommentId] = useState<string | null>(null);

  const { isAuthenticated } = useAuthContext();
  const commentsDisabled = property.commentsDisabled === true;

  // Fetch comments
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useComments(property.id, sortBy);

  const submitMutation = useSubmitComment(property.id);
  const likeMutation = useLikeComment(property.id);

  // Flatten pages of comments
  const allComments = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.data);
  }, [data?.pages]);

  // Show limited comments initially, all when expanded
  const displayedComments = showAllComments ? allComments : allComments.slice(0, 3);
  const totalComments = data?.pages[0]?.meta.total ?? property.commentCount;
  const hasMoreComments = allComments.length > 3 && !showAllComments;

  // Handle like
  const handleLike = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.(COMMENT_AUTH_REQUIRED_COPY);
        return;
      }

      const targetComment = allComments.find((comment) => comment.id === commentId)
        ?? allComments.flatMap((comment) => comment.replies).find((reply) => reply.id === commentId);

      const isCurrentlyLiked = targetComment?.isLiked ?? false;

      likeMutation.mutate({ commentId, isCurrentlyLiked });
    },
    [allComments, isAuthenticated, likeMutation, onAuthRequired]
  );

  // Handle reply
  const handleReply = useCallback(
    (commentId: string, username: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.(COMMENT_AUTH_REQUIRED_COPY);
        return;
      }
      setReplyTo({ id: commentId, username });
    },
    [isAuthenticated, onAuthRequired]
  );

  // Handle cancel reply
  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  // Handle submit
  const submitComment = useCallback(
    (content: string, parentId?: string) => {
      submitMutation.mutate(
        { content, parentId },
        {
          onSuccess: () => {
            setReplyTo(null);
          },
        }
      );
    },
    [submitMutation]
  );

  const handleSubmit = useCallback(
    (content: string) => {
      if (!isAuthenticated) {
        setPendingSubmitAfterAuth({ content, parentId: replyTo?.id });
        onAuthRequired?.(COMMENT_AUTH_REQUIRED_COPY);
        return false;
      }

      submitComment(content, replyTo?.id);
      return true;
    },
    [isAuthenticated, onAuthRequired, replyTo?.id, submitComment]
  );

  useEffect(() => {
    if (!isAuthenticated || !pendingSubmitAfterAuth) {
      return;
    }

    const pending = pendingSubmitAfterAuth;
    setPendingSubmitAfterAuth(null);
    submitComment(pending.content, pending.parentId);
  }, [isAuthenticated, pendingSubmitAfterAuth, submitComment]);

  // Handle sort change
  const handleSortChange = useCallback((newSort: CommentSortBy) => {
    setSortBy(newSort);
  }, []);

  // Handle view all
  const handleViewAll = useCallback(() => {
    if (onViewAll) {
      onViewAll();
    } else {
      setShowAllComments(true);
      // Load more if needed
      if (hasNextPage) {
        fetchNextPage();
      }
    }
  }, [onViewAll, hasNextPage, fetchNextPage]);

  if (commentsDisabled) {
    return (
      <SectionCard
        title="Comments"
        icon="chatbubbles"
        description="Read the neighborhood takes and add your own perspective on the address."
      >
        <View style={styles.disabledState}>
          <Ionicons name="lock-closed-outline" size={32} color="#C7BFB3" />
          <Text style={styles.disabledText}>Comments are disabled for this property</Text>
        </View>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Comments"
      icon="chatbubbles"
      description="Read the neighborhood takes and add your own perspective on the address."
      trailing={totalComments > 0 ? (
        <View style={styles.commentBadge}>
          <Text style={styles.commentBadgeText}>{totalComments}</Text>
        </View>
      ) : null}
    >
      {totalComments > 0 && (
        <View style={styles.sortWrap}>
          <Pressable
            onPress={() => handleSortChange('recent')}
            style={[styles.sortChip, sortBy === 'recent' && styles.sortChipActive]}
          >
            <Text style={[styles.sortText, sortBy === 'recent' && styles.sortTextActive]}>
              Recent
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleSortChange('popular')}
            style={[styles.sortChip, sortBy === 'popular' && styles.sortChipActive]}
          >
            <Text style={[styles.sortText, sortBy === 'popular' && styles.sortTextActive]}>
              Popular
            </Text>
          </Pressable>
        </View>
      )}

      {/* Loading state */}
      {isLoading && (
        <View className="py-8 items-center">
          <ActivityIndicator size="small" color="#F5A623" />
          <Text className="text-warm-500 text-sm mt-2">Loading comments...</Text>
        </View>
      )}

      {/* Error state */}
      {isError && (
        <View className="bg-red-50 rounded-xl p-4 items-center">
          <Ionicons name="alert-circle-outline" size={32} color="#EF4444" />
          <Text className="text-red-600 mt-2">Failed to load comments</Text>
          <Pressable
            onPress={() => refetch()}
            className="mt-2 bg-red-100 px-3 py-1.5 rounded-lg"
          >
            <Text className="text-red-700 text-sm font-medium">Retry</Text>
          </Pressable>
        </View>
      )}

      {/* Empty state */}
      {!isLoading && !isError && allComments.length === 0 && (
        <View className="bg-warm-50 rounded-xl p-4 items-center">
          <Ionicons name="chatbubble-ellipses-outline" size={32} color="#C7BFB3" />
          <Text className="text-warm-500 mt-2">No comments yet</Text>
          <Text className="text-xs text-warm-400 mt-1">
            Be the first to share your thoughts!
          </Text>
        </View>
      )}

      {/* Comments list */}
      {!isLoading && !isError && displayedComments.length > 0 && (
        <View style={styles.commentList}>
          {displayedComments.map((comment, index) => (
            <View key={comment.id}>
              {index > 0 && <View className="h-px bg-warm-100" />}
              <Comment
                comment={comment}
                onLike={handleLike}
                onReply={handleReply}
                onReport={setReportCommentId}
                isLiked={comment.isLiked}
              />
            </View>
          ))}

          {/* View all / Load more */}
          {(hasMoreComments || hasNextPage) && (
            <Pressable
              onPress={handleViewAll}
              className="py-3 items-center border-t border-warm-100 mt-2"
            >
              {isFetchingNextPage ? (
                <ActivityIndicator size="small" color="#F5A623" />
              ) : (
                <Text className="text-primary-600 text-sm font-medium">
                  {hasMoreComments
                    ? `View all ${totalComments} comments`
                    : 'Load more comments'}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {/* Comment input */}
      <View className="mt-3">
        <CommentInput
          onSubmit={handleSubmit}
          replyTo={replyTo}
          onCancelReply={handleCancelReply}
          isSubmitting={submitMutation.isPending}
          placeholder={
            isAuthenticated
              ? 'Share your thoughts...'
              : 'Log in to comment...'
          }
        />
      </View>
      {reportCommentId ? (
        <ReportModal
          visible
          target={{ type: 'comment', id: reportCommentId }}
          targetLabel="Tell us what is wrong with this comment."
          onClose={() => setReportCommentId(null)}
        />
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  commentBadge: {
    minWidth: 28,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#FFF3DD',
    alignItems: 'center',
  },
  commentBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#C18A10',
  },
  sortWrap: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: '#FBF4E7',
    borderRadius: 999,
    padding: 3,
    marginBottom: 14,
    gap: 4,
  },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  sortChipActive: {
    backgroundColor: '#FFFFFF',
  },
  sortText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8C8479',
  },
  sortTextActive: {
    color: '#2D2926',
  },
  commentList: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F5EBDD',
    backgroundColor: '#FFFCF7',
  },
  disabledState: {
    borderRadius: 12,
    backgroundColor: '#FFFBF5',
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  disabledText: {
    fontSize: 14,
    fontWeight: '400',
    color: '#9C958A',
    textAlign: 'center',
  },
});
