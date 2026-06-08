import { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Comment, type CommentData } from './Comment';
import { CommentInput } from './CommentInput';
import {
  useComments,
  useSubmitComment,
  useLikeComment,
  useDeleteComment,
  type CommentSortBy,
} from '../../hooks/useComments';
import { useAuthContext } from '../../providers/AuthProvider';
import { useT } from '../../i18n';

export interface CommentsListProps {
  propertyId: string;
  onAuthRequired?: () => void;
}

/**
 * CommentsList Component
 * Full comments list with sorting, pagination, and interaction handling
 */
export function CommentsList({ propertyId, onAuthRequired }: CommentsListProps) {
  const t = useT();
  const [sortBy, setSortBy] = useState<CommentSortBy>('popular');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);

  const { isAuthenticated, user } = useAuthContext();

  // Data fetching hooks
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
  const deleteMutation = useDeleteComment(propertyId);

  // Flatten all pages of comments
  const comments = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.data);
  }, [data?.pages]);

  const totalComments = data?.pages[0]?.meta.total ?? 0;

  // Handle like action
  const handleLike = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.();
        return;
      }

      const targetComment = comments.find((comment) => comment.id === commentId)
        ?? comments
          .flatMap((comment) => comment.replies ?? [])
          .find((reply) => reply.id === commentId);

      const isCurrentlyLiked = targetComment?.isLiked ?? false;

      // Call mutation
      likeMutation.mutate({ commentId, isCurrentlyLiked });
    },
    [comments, isAuthenticated, likeMutation, onAuthRequired]
  );

  // Handle reply action
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

  const handleDelete = useCallback(
    (commentId: string) => {
      deleteMutation.mutate(commentId);
    },
    [deleteMutation],
  );

  // Handle cancel reply
  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  // Handle submit comment
  const handleSubmit = useCallback(
    (content: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.();
        return false;
      }

      submitMutation.mutate(
        { content, parentId: replyTo?.id },
        {
          onSuccess: () => {
            setReplyTo(null);
          },
        }
      );
      return true;
    },
    [isAuthenticated, onAuthRequired, replyTo?.id, submitMutation]
  );

  // Handle sort change
  const handleSortChange = useCallback((newSort: CommentSortBy) => {
    setSortBy(newSort);
  }, []);

  // Handle load more
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Render individual comment
  const renderComment = useCallback(
    ({ item }: { item: CommentData }) => (
      <Comment
        comment={item}
        onLike={handleLike}
        onReply={handleReply}
        onDelete={handleDelete}
        currentUserId={user?.id ?? null}
        isLiked={item.isLiked}
      />
    ),
    [handleDelete, handleLike, handleReply, user?.id]
  );

  // Render separator
  const renderSeparator = useCallback(
    () => <View className="h-px bg-warm-100" />,
    []
  );

  // Render footer (loading more)
  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View className="py-4 items-center">
        <ActivityIndicator size="small" color="#F5A623" />
      </View>
    );
  }, [isFetchingNextPage]);

  // Render empty state
  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View className="py-12 items-center">
        <Ionicons name="chatbubble-ellipses-outline" size={48} color="#E8E0D4" />
        <Text className="text-warm-500 mt-3 text-base">{t('comments.empty.title')}</Text>
        <Text className="text-warm-400 text-sm mt-1">
          {t('comments.empty.body')}
        </Text>
      </View>
    );
  }, [isLoading, t]);

  // Render header with sort toggle
  const renderHeader = useCallback(
    () => (
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-warm-100">
        <View className="flex-row items-center">
          <Ionicons name="chatbubbles" size={20} color="#F5A623" />
          <Text className="text-lg font-semibold text-warm-900 ml-2">
            {t('comments.title')}
          </Text>
          {totalComments > 0 && (
            <View className="ml-2 bg-warm-100 px-2 py-0.5 rounded-full">
              <Text className="text-xs text-warm-600">{totalComments}</Text>
            </View>
          )}
        </View>

        {/* Sort toggle */}
        <View className="flex-row bg-warm-100 rounded-lg p-0.5">
          <Pressable
            onPress={() => handleSortChange('popular')}
            className={`px-3 py-1.5 rounded-md ${
              sortBy === 'popular' ? 'bg-surface-card shadow-sm' : ''
            }`}
            testID="sort-popular"
          >
            <Text
              className={`text-sm ${
                sortBy === 'popular'
                  ? 'text-warm-900 font-medium'
                  : 'text-warm-500'
              }`}
            >
              {t('comments.sort.popular')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleSortChange('recent')}
            className={`px-3 py-1.5 rounded-md ${
              sortBy === 'recent' ? 'bg-surface-card shadow-sm' : ''
            }`}
            testID="sort-recent"
          >
            <Text
              className={`text-sm ${
                sortBy === 'recent'
                  ? 'text-warm-900 font-medium'
                  : 'text-warm-500'
              }`}
            >
              {t('comments.sort.recent')}
            </Text>
          </Pressable>
        </View>
      </View>
    ),
    [sortBy, totalComments, handleSortChange, t]
  );

  // Error state
  if (isError) {
    return (
      <View className="flex-1 py-12 items-center justify-center">
        <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
        <Text className="text-warm-700 mt-3 text-base">
          {t('comments.loadError')}
        </Text>
        <Text className="text-warm-500 text-sm mt-1">
          {error?.message || t('profile.follow.errorFallback')}
        </Text>
        <Pressable
          onPress={() => refetch()}
          className="mt-4 bg-primary-500 px-4 py-2 rounded-lg"
        >
          <Text className="text-white font-medium">{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <View className="flex-1">
        {renderHeader()}
        <View className="flex-1 py-12 items-center justify-center">
          <ActivityIndicator size="large" color="#F5A623" />
          <Text className="text-warm-500 mt-3">{t('comments.loading')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface-card">
      {renderHeader()}

      <FlatList
        data={comments}
        keyExtractor={(item) => item.id}
        renderItem={renderComment}
        ItemSeparatorComponent={renderSeparator}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            colors={['#F5A623']}
            tintColor="#F5A623"
          />
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        testID="comments-list"
      />

      {/* Comment input - always visible at bottom */}
      <View className="absolute bottom-0 left-0 right-0">
        <CommentInput
          onSubmit={handleSubmit}
          replyTo={replyTo}
          onCancelReply={handleCancelReply}
          isSubmitting={submitMutation.isPending}
          isAuthenticated={isAuthenticated}
          currentUsername={user?.username ?? user?.handle}
          currentUserDisplayName={user?.displayName}
          currentUserProfilePhotoUrl={user?.profilePhotoUrl ?? null}
          placeholder={t('comments.placeholder.authenticated')}
        />
      </View>
    </View>
  );
}
