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
import { useComments, useSubmitComment, useLikeComment, type CommentSortBy } from '../../hooks/useComments';
import { useAuthContext } from '../../providers/AuthProvider';

export interface CommentsListProps {
  propertyId: string;
  onAuthRequired?: () => void;
}

/**
 * CommentsList Component
 * Full comments list with sorting, pagination, and interaction handling
 */
export function CommentsList({ propertyId, onAuthRequired }: CommentsListProps) {
  const [sortBy, setSortBy] = useState<CommentSortBy>('recent');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());

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

      const isCurrentlyLiked = likedComments.has(commentId);

      // Optimistically update local state
      setLikedComments((prev) => {
        const next = new Set(prev);
        if (isCurrentlyLiked) {
          next.delete(commentId);
        } else {
          next.add(commentId);
        }
        return next;
      });

      // Call mutation
      likeMutation.mutate({ commentId, isCurrentlyLiked });
    },
    [isAuthenticated, likedComments, likeMutation, onAuthRequired]
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

  // Handle cancel reply
  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  // Handle submit comment
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
        isLiked={likedComments.has(item.id)}
      />
    ),
    [handleLike, handleReply, likedComments]
  );

  // Render separator
  const renderSeparator = useCallback(
    () => <View className="h-px bg-gray-100" />,
    []
  );

  // Render footer (loading more)
  const renderFooter = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View className="py-4 items-center">
        <ActivityIndicator size="small" color="#3B82F6" />
      </View>
    );
  }, [isFetchingNextPage]);

  // Render empty state
  const renderEmpty = useCallback(() => {
    if (isLoading) return null;
    return (
      <View className="py-12 items-center">
        <Ionicons name="chatbubble-ellipses-outline" size={48} color="#D1D5DB" />
        <Text className="text-gray-500 mt-3 text-base">No comments yet</Text>
        <Text className="text-gray-400 text-sm mt-1">
          Be the first to share your thoughts!
        </Text>
      </View>
    );
  }, [isLoading]);

  // Render header with sort toggle
  const renderHeader = useCallback(
    () => (
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
        <View className="flex-row items-center">
          <Ionicons name="chatbubbles" size={20} color="#3B82F6" />
          <Text className="text-lg font-semibold text-gray-900 ml-2">
            Comments
          </Text>
          {totalComments > 0 && (
            <View className="ml-2 bg-gray-100 px-2 py-0.5 rounded-full">
              <Text className="text-xs text-gray-600">{totalComments}</Text>
            </View>
          )}
        </View>

        {/* Sort toggle */}
        <View className="flex-row bg-gray-100 rounded-lg p-0.5">
          <Pressable
            onPress={() => handleSortChange('recent')}
            className={`px-3 py-1.5 rounded-md ${
              sortBy === 'recent' ? 'bg-white shadow-sm' : ''
            }`}
            testID="sort-recent"
          >
            <Text
              className={`text-sm ${
                sortBy === 'recent'
                  ? 'text-gray-900 font-medium'
                  : 'text-gray-500'
              }`}
            >
              Recent
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleSortChange('popular')}
            className={`px-3 py-1.5 rounded-md ${
              sortBy === 'popular' ? 'bg-white shadow-sm' : ''
            }`}
            testID="sort-popular"
          >
            <Text
              className={`text-sm ${
                sortBy === 'popular'
                  ? 'text-gray-900 font-medium'
                  : 'text-gray-500'
              }`}
            >
              Popular
            </Text>
          </Pressable>
        </View>
      </View>
    ),
    [sortBy, totalComments, handleSortChange]
  );

  // Error state
  if (isError) {
    return (
      <View className="flex-1 py-12 items-center justify-center">
        <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
        <Text className="text-gray-700 mt-3 text-base">
          Failed to load comments
        </Text>
        <Text className="text-gray-500 text-sm mt-1">
          {error?.message || 'Please try again'}
        </Text>
        <Pressable
          onPress={() => refetch()}
          className="mt-4 bg-primary-500 px-4 py-2 rounded-lg"
        >
          <Text className="text-white font-medium">Retry</Text>
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
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text className="text-gray-500 mt-3">Loading comments...</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
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
            colors={['#3B82F6']}
            tintColor="#3B82F6"
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
