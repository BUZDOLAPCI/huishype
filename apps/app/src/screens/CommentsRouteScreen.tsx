import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CommentCell,
  type CommentData as CommentCellData,
} from '@/src/components/CommentCell';
import { CommentInput } from '@/src/components/CommentInput';
import { AuthModal } from '@/src/components';
import { PropertyImageSurface } from '@/src/components/PropertyImageSurface';
import { formatRelativeTime } from '@/src/components/Comments/Comment';
import { useComments, useLikeComment, useSubmitComment, type Comment, type CommentSortBy } from '@/src/hooks/useComments';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import { useProperty } from '@/src/hooks/useProperties';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { resolvePropertyImageWithType } from '@/src/utils/property-image';

function toCommentCellData(
  comment: Comment,
  hydratedNow: number | null,
): CommentCellData {
  return {
    id: comment.id,
    author: comment.user.username,
    authorDisplayName: comment.user.displayName ?? undefined,
    authorKarma: comment.user.karma,
    content: comment.content,
    likeCount: comment.likeCount,
    createdAt:
      hydratedNow === null
        ? '\u00A0'
        : formatRelativeTime(comment.createdAt, hydratedNow),
    replyCount: comment.replies?.length ?? 0,
    replies: comment.replies?.map((reply) => toCommentCellData(reply, hydratedNow)),
  };
}

function SortToggle({
  value,
  onChange,
}: {
  value: CommentSortBy;
  onChange: (sort: CommentSortBy) => void;
}) {
  return (
    <View style={styles.sortContainer}>
      <Pressable
        onPress={() => onChange('popular')}
        style={[styles.sortPill, value === 'popular' && styles.sortPillActive]}
      >
        <Text
          style={[styles.sortText, value === 'popular' && styles.sortTextActive]}
        >
          Popular
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('recent')}
        style={[styles.sortPill, value === 'recent' && styles.sortPillActive]}
      >
        <Text style={[styles.sortText, value === 'recent' && styles.sortTextActive]}>
          Recent
        </Text>
      </Pressable>
    </View>
  );
}

export interface CommentsRouteScreenProps {
  propertyId?: string | null;
}

export function CommentsRouteScreen({
  propertyId,
}: CommentsRouteScreenProps) {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuthContext();
  const hydratedNow = useHydratedNow();

  const [sortBy, setSortBy] = useState<CommentSortBy>('popular');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(
    null,
  );
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const [showAuthModal, setShowAuthModal] = useState(false);

  const { data: property } = useProperty(propertyId ?? null);
  const {
    data: commentsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useComments(propertyId ?? '', sortBy);

  const submitMutation = useSubmitComment(propertyId ?? '');
  const likeMutation = useLikeComment(propertyId ?? '');

  const allComments = useMemo(() => {
    if (!commentsData?.pages) return [];
    return commentsData.pages.flatMap((page) => page.data);
  }, [commentsData?.pages]);

  const totalComments = commentsData?.pages[0]?.meta.total ?? 0;

  const cellComments: CommentCellData[] = useMemo(
    () => allComments.map((comment) => toCommentCellData(comment, hydratedNow)),
    [allComments, hydratedNow],
  );

  const handleLike = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }
      const isCurrentlyLiked = likedComments.has(commentId);
      setLikedComments((prev) => {
        const next = new Set(prev);
        if (isCurrentlyLiked) next.delete(commentId);
        else next.add(commentId);
        return next;
      });
      likeMutation.mutate({ commentId, isCurrentlyLiked });
    },
    [isAuthenticated, likedComments, likeMutation],
  );

  const handleReply = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }
      const comment = allComments.find((candidate) => candidate.id === commentId);
      if (comment) {
        setReplyTo({ id: commentId, username: comment.user.username });
      }
    },
    [allComments, isAuthenticated],
  );

  const handleSubmit = useCallback(
    (content: string) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }
      submitMutation.mutate(
        { content, parentId: replyTo?.id },
        { onSuccess: () => setReplyTo(null) },
      );
    },
    [isAuthenticated, replyTo?.id, submitMutation],
  );

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const propertyImage = property
    ? resolvePropertyImageWithType({
        listingPhotoUrl: (property as any).listingPhotoUrl ?? null,
        aerialImageUrl: (property as any).aerialImageUrl ?? null,
        countryCode: property.countryCode,
      })
    : { url: null, type: 'placeholder' as const };

  return (
    <>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {property ? (
          <View style={styles.headerPropertyInfo}>
            {propertyImage.url ? (
              <PropertyImageSurface
                source={{
                  listingPhotoUrl: (property as any).listingPhotoUrl ?? null,
                  aerialImageUrl: (property as any).aerialImageUrl ?? null,
                  countryCode: property.countryCode,
                }}
                style={styles.headerThumbnail}
                markerSize={16}
                imageTestID="comments-property-image"
                markerTestID="comments-property-marker"
              />
            ) : null}
            <View style={styles.headerTextColumn}>
              <Text style={styles.headerAddress} numberOfLines={1}>
                {property.address}
              </Text>
              <Text style={styles.headerCity} numberOfLines={1}>
                {property.city}
                {property.postalCode ? `, ${property.postalCode}` : ''}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.subHeader}>
          <Text style={styles.commentCount}>
            {totalComments} {totalComments === 1 ? 'comment' : 'comments'}
          </Text>
          <SortToggle value={sortBy} onChange={setSortBy} />
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#F5A623" />
          </View>
        ) : (
          <FlatList
            data={cellComments}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <CommentCell
                comment={item}
                onLike={handleLike}
                onReply={handleReply}
              />
            )}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: insets.bottom + 100 },
            ]}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              isFetchingNextPage ? (
                <ActivityIndicator color="#F5A623" style={styles.loadingMore} />
              ) : null
            }
          />
        )}

        <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 12 }]}>
          <CommentInput
            onSubmit={handleSubmit}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
          />
        </View>
      </KeyboardAvoidingView>

      <AuthModal visible={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </>
  );
}

export default CommentsRouteScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFBF5',
  },
  headerPropertyInfo: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  headerThumbnail: {
    borderRadius: 14,
    height: 56,
    overflow: 'hidden',
    width: 72,
  },
  headerTextColumn: {
    flex: 1,
    gap: 4,
  },
  headerAddress: {
    color: '#2D2926',
    fontSize: 16,
    fontWeight: '600',
  },
  headerCity: {
    color: '#8A8276',
    fontSize: 13,
  },
  subHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  commentCount: {
    color: '#3D3832',
    fontSize: 15,
    fontWeight: '600',
  },
  sortContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  sortPill: {
    backgroundColor: '#FFF8F0',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  sortPillActive: {
    backgroundColor: '#F5A623',
  },
  sortText: {
    color: '#736C62',
    fontSize: 12,
    fontWeight: '600',
  },
  sortTextActive: {
    color: '#FFFFFF',
  },
  loadingContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  loadingMore: {
    marginVertical: 12,
  },
  inputContainer: {
    borderTopColor: '#F0E7DB',
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#FFFBF5',
  },
});
