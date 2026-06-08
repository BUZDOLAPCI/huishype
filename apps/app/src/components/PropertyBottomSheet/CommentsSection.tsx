import { useEffect, useState, useCallback, useMemo } from 'react';
import { Pressable, Text, View, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SectionProps } from './types';
import { CommentInput, CommentSortToggle } from '../Comments';
import { CommentCell } from '../CommentCell';
import { toCommentCellData } from '../comment-cell-data';
import {
  useComments,
  useSubmitComment,
  useLikeComment,
  type Comment,
  type CommentSortBy,
} from '../../hooks/useComments';
import { useAuthContext } from '../../providers/AuthProvider';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';
import { SectionCard } from './SectionCard';
import { ReportModal } from '../ReportModal';
import { useT } from '../../i18n';
import { useHydratedNow } from '../../hooks/useHydratedNow';

interface CommentsSectionProps extends SectionProps {
  onViewAll?: () => void;
  onAuthRequired?: (copy?: AuthModalCopyInput) => void;
}

const COMMENT_PREVIEW_LIMIT = 3;

function findCommentById(comments: Comment[], commentId: string): Comment | undefined {
  for (const comment of comments) {
    if (comment.id === commentId) {
      return comment;
    }

    const reply = findCommentById(comment.replies ?? [], commentId);
    if (reply) {
      return reply;
    }
  }

  return undefined;
}

/**
 * CommentsSection Component
 * Displays comments within the PropertyBottomSheet with full interaction support
 */
export function CommentsSection({
  property,
  onViewAll,
  onAuthRequired,
}: CommentsSectionProps) {
  const t = useT();
  const hydratedNow = useHydratedNow();
  const [sortBy, setSortBy] = useState<CommentSortBy>('popular');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [showAllComments, setShowAllComments] = useState(false);
  const [pendingSubmitAfterAuth, setPendingSubmitAfterAuth] = useState<{
    content: string;
    parentId?: string;
  } | null>(null);
  const [reportCommentId, setReportCommentId] = useState<string | null>(null);

  const { isAuthenticated, user } = useAuthContext();
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

  // Show limited comments initially, all loaded comments when expanded.
  const displayedComments = useMemo(
    () => (showAllComments ? allComments : allComments.slice(0, COMMENT_PREVIEW_LIMIT)),
    [allComments, showAllComments],
  );
  const totalComments = data?.pages[0]?.meta.total ?? property.commentCount;
  const hasMoreComments = totalComments > displayedComments.length && !showAllComments;
  const cellComments = useMemo(
    () => displayedComments.map((comment) => toCommentCellData(comment, hydratedNow)),
    [displayedComments, hydratedNow],
  );

  // Handle like
  const handleLike = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.(t('comments.auth.post') as AuthModalCopyInput);
        return;
      }

      const targetComment = findCommentById(allComments, commentId);
      const isCurrentlyLiked = targetComment?.isLiked ?? false;

      likeMutation.mutate({ commentId, isCurrentlyLiked });
    },
    [allComments, isAuthenticated, likeMutation, onAuthRequired, t]
  );

  // Handle reply
  const handleReply = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.(t('comments.auth.post') as AuthModalCopyInput);
        return;
      }
      const targetComment = findCommentById(allComments, commentId);
      if (targetComment) {
        setReplyTo({ id: commentId, username: targetComment.user.username });
      }
    },
    [allComments, isAuthenticated, onAuthRequired, t]
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
        onAuthRequired?.(t('comments.auth.post') as AuthModalCopyInput);
        return false;
      }

      submitComment(content, replyTo?.id);
      return true;
    },
    [isAuthenticated, onAuthRequired, replyTo?.id, submitComment, t]
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
        title={t('comments.title')}
        icon="chatbubbles"
        description={t('comments.description')}
      >
        <View style={styles.previewHeader}>
          <Text style={styles.commentCount}>
            {t(totalComments === 1 ? 'comments.count.one' : 'comments.count.other', {
              count: totalComments,
            })}
          </Text>
        </View>
        <View style={styles.disabledState}>
          <Ionicons name="lock-closed-outline" size={32} color="#C7BFB3" />
          <Text style={styles.disabledText}>{t('comments.disabled')}</Text>
        </View>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={t('comments.title')}
      icon="chatbubbles"
      description={t('comments.description')}
    >
      <View style={styles.previewHeader}>
        <View style={styles.previewHeaderTopRow}>
          <Text style={styles.commentCount}>
            {t(totalComments === 1 ? 'comments.count.one' : 'comments.count.other', {
              count: totalComments,
            })}
          </Text>
          {totalComments > 0 && (
            <CommentSortToggle value={sortBy} onChange={handleSortChange} />
          )}
        </View>
      </View>

      {/* Loading state */}
      {isLoading && (
        <View className="py-8 items-center">
          <ActivityIndicator size="small" color="#F5A623" />
          <Text className="text-warm-500 text-sm mt-2">{t('comments.loading')}</Text>
        </View>
      )}

      {/* Error state */}
      {isError && (
        <View className="bg-red-50 rounded-xl p-4 items-center">
          <Ionicons name="alert-circle-outline" size={32} color="#EF4444" />
          <Text className="text-red-600 mt-2">{t('comments.loadError')}</Text>
          <Pressable
            onPress={() => refetch()}
            className="mt-2 bg-red-100 px-3 py-1.5 rounded-lg"
          >
            <Text className="text-red-700 text-sm font-medium">{t('common.retry')}</Text>
          </Pressable>
        </View>
      )}

      {/* Empty state */}
      {!isLoading && !isError && allComments.length === 0 && (
        <View className="bg-warm-50 rounded-xl p-4 items-center">
          <Ionicons name="chatbubble-ellipses-outline" size={32} color="#C7BFB3" />
          <Text className="text-warm-500 mt-2">{t('comments.empty.title')}</Text>
          <Text className="text-xs text-warm-400 mt-1">
            {t('comments.empty.body')}
          </Text>
        </View>
      )}

      {/* Comments list */}
      {!isLoading && !isError && cellComments.length > 0 && (
        <View style={styles.listContent}>
          {cellComments.map((comment) => (
            <CommentCell
              key={comment.id}
              comment={comment}
              onLike={handleLike}
              onReply={handleReply}
              onReport={setReportCommentId}
            />
          ))}

          {/* View all / Load more */}
          {(hasMoreComments || hasNextPage) && (
            <Pressable
              onPress={handleViewAll}
              style={styles.viewAllButton}
            >
              {isFetchingNextPage ? (
                <ActivityIndicator size="small" color="#F5A623" />
              ) : (
                <Text style={styles.viewAllText}>
                  {hasMoreComments || onViewAll
                    ? t('comments.viewAll', { count: totalComments })
                    : t('comments.loadMore')}
                </Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {/* Comment input */}
      <View style={styles.previewComposer}>
        <CommentInput
          onSubmit={handleSubmit}
          replyTo={replyTo}
          onCancelReply={handleCancelReply}
          isSubmitting={submitMutation.isPending}
          isAuthenticated={isAuthenticated}
          currentUsername={user?.username ?? user?.handle}
          currentUserDisplayName={user?.displayName}
          currentUserProfilePhotoUrl={user?.profilePhotoUrl ?? null}
          variant="compact"
          placeholder={t('comments.placeholder.authenticated')}
        />
      </View>
      {reportCommentId ? (
        <ReportModal
          visible
          target={{ type: 'comment', id: reportCommentId }}
          targetLabel={t('comments.reportTarget')}
          onClose={() => setReportCommentId(null)}
        />
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  previewHeader: {
    marginBottom: 14,
  },
  previewHeaderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  commentCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3D3832',
  },
  listContent: {
    gap: 12,
  },
  viewAllButton: {
    paddingTop: 6,
    paddingBottom: 10,
    alignItems: 'center',
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#D98900',
  },
  previewComposer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F5F0E8',
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
