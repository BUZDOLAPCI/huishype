import { useState, useCallback, useMemo } from 'react';
import { Pressable, Text, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SectionProps } from './types';
import { Comment, CommentInput, KarmaBadge } from '../Comments';
import type { CommentData } from '../Comments';
import { useComments, useSubmitComment, useLikeComment, type CommentSortBy } from '../../hooks/useComments';
import { useAuthContext } from '../../providers/AuthProvider';

interface CommentsSectionProps extends SectionProps {
  onAddComment?: () => void;
  onViewAll?: () => void;
  onAuthRequired?: () => void;
}

/**
 * CommentsSection Component
 * Displays comments within the PropertyBottomSheet with full interaction support
 */
export function CommentsSection({
  property,
  onAddComment,
  onViewAll,
  onAuthRequired,
}: CommentsSectionProps) {
  const [sortBy, setSortBy] = useState<CommentSortBy>('recent');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const [showAllComments, setShowAllComments] = useState(false);

  const { isAuthenticated, user } = useAuthContext();

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
        onAuthRequired?.();
        return;
      }

      const isCurrentlyLiked = likedComments.has(commentId);

      // Optimistic update
      setLikedComments((prev) => {
        const next = new Set(prev);
        if (isCurrentlyLiked) {
          next.delete(commentId);
        } else {
          next.add(commentId);
        }
        return next;
      });

      likeMutation.mutate({ commentId, isCurrentlyLiked });
    },
    [isAuthenticated, likedComments, likeMutation, onAuthRequired]
  );

  // Handle reply
  const handleReply = useCallback(
    (commentId: string, username: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.();
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
        }
      );
    },
    [isAuthenticated, onAuthRequired, replyTo?.id, submitMutation]
  );

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

  // Handle load more
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <View className="px-4 py-4 border-t border-gray-100">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <Ionicons name="chatbubbles" size={20} color="#3B82F6" />
          <Text className="text-lg font-semibold text-gray-900 ml-2">Comments</Text>
          {totalComments > 0 && (
            <View className="ml-2 bg-gray-100 px-2 py-0.5 rounded-full">
              <Text className="text-xs text-gray-600">{totalComments}</Text>
            </View>
          )}
        </View>

        {/* Sort toggle */}
        {totalComments > 0 && (
          <View className="flex-row bg-gray-100 rounded-lg p-0.5">
            <Pressable
              onPress={() => handleSortChange('recent')}
              className={`px-2.5 py-1 rounded-md ${
                sortBy === 'recent' ? 'bg-white shadow-sm' : ''
              }`}
            >
              <Text
                className={`text-xs ${
                  sortBy === 'recent' ? 'text-gray-900 font-medium' : 'text-gray-500'
                }`}
              >
                Recent
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleSortChange('popular')}
              className={`px-2.5 py-1 rounded-md ${
                sortBy === 'popular' ? 'bg-white shadow-sm' : ''
              }`}
            >
              <Text
                className={`text-xs ${
                  sortBy === 'popular' ? 'text-gray-900 font-medium' : 'text-gray-500'
                }`}
              >
                Popular
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Loading state */}
      {isLoading && (
        <View className="py-8 items-center">
          <ActivityIndicator size="small" color="#3B82F6" />
          <Text className="text-gray-500 text-sm mt-2">Loading comments...</Text>
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
        <View className="bg-gray-50 rounded-xl p-4 items-center">
          <Ionicons name="chatbubble-ellipses-outline" size={32} color="#9CA3AF" />
          <Text className="text-gray-500 mt-2">No comments yet</Text>
          <Text className="text-xs text-gray-400 mt-1">
            Be the first to share your thoughts!
          </Text>
        </View>
      )}

      {/* Comments list */}
      {!isLoading && !isError && displayedComments.length > 0 && (
        <View>
          {displayedComments.map((comment, index) => (
            <View key={comment.id}>
              {index > 0 && <View className="h-px bg-gray-100" />}
              <Comment
                comment={comment}
                onLike={handleLike}
                onReply={handleReply}
                isLiked={likedComments.has(comment.id)}
              />
            </View>
          ))}

          {/* View all / Load more */}
          {(hasMoreComments || hasNextPage) && (
            <Pressable
              onPress={handleViewAll}
              className="py-3 items-center border-t border-gray-100 mt-2"
            >
              {isFetchingNextPage ? (
                <ActivityIndicator size="small" color="#3B82F6" />
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
    </View>
  );
}
