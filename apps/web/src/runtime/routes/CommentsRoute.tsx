import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { AuthModal } from '@/src/components';
import { CommentCell, type CommentData as CommentCellData } from '@/src/components/CommentCell';
import { CommentInput } from '@/src/components/CommentInput';
import { Icon } from '@/src/components/ui/Icon';
import { PropertyImageSurface } from '@/src/components/PropertyImageSurface';
import { ResponsivePanel } from '@/src/components/ui/ResponsivePanel';
import { useProperty } from '@/src/hooks/useProperties';
import {
  useComments,
  useLikeComment,
  useSubmitComment,
  type Comment,
  type CommentSortBy,
} from '@/src/hooks/useComments';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { formatRelativeTime } from '@/src/components/Comments/Comment';
import { resolvePropertyImageWithType } from '@/src/utils/property-image';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
  mergeStyles,
} from '../dom';
import { colors } from '../theme';

function toCommentCellData(comment: Comment): CommentCellData {
  return {
    id: comment.id,
    author: comment.user.username,
    authorDisplayName: comment.user.displayName ?? undefined,
    authorKarma: comment.user.karma,
    content: comment.content,
    likeCount: comment.likeCount,
    createdAt: formatRelativeTime(comment.createdAt),
    replyCount: comment.replies?.length ?? 0,
    replies: comment.replies?.map(toCommentCellData),
  };
}

function SortToggle({ value, onChange }: { value: CommentSortBy; onChange: (sort: CommentSortBy) => void }) {
  return (
    <View style={styles.sortContainer}>
      <Pressable
        onPress={() => onChange('popular')}
        style={mergeStyles(styles.sortPill, value === 'popular' ? styles.sortPillActive : null)}
      >
        <Text style={mergeStyles(styles.sortText, value === 'popular' ? styles.sortTextActive : null)}>Popular</Text>
      </Pressable>
      <Pressable
        onPress={() => onChange('recent')}
        style={mergeStyles(styles.sortPill, value === 'recent' ? styles.sortPillActive : null)}
      >
        <Text style={mergeStyles(styles.sortText, value === 'recent' ? styles.sortTextActive : null)}>Recent</Text>
      </Pressable>
    </View>
  );
}

export function CommentsRoute() {
  const navigate = useNavigate();
  const { propertyId = 'property' } = useParams();
  const { isAuthenticated } = useAuthContext();

  const [sortBy, setSortBy] = useState<CommentSortBy>('popular');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
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

  const cellComments = useMemo(() => allComments.map(toCommentCellData), [allComments]);

  const handleLike = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }
      const isCurrentlyLiked = likedComments.has(commentId);
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
    [isAuthenticated, likedComments, likeMutation],
  );

  const handleReply = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }
      const comment = allComments.find((entry) => entry.id === commentId);
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

  const propertyImage = property
    ? resolvePropertyImageWithType({
        listingPhotoUrl: (property as any).listingPhotoUrl ?? null,
        aerialImageUrl: (property as any).aerialImageUrl ?? null,
        countryCode: property.countryCode,
      })
    : { url: null, type: 'placeholder' as const };

  const topInset = 16;

  return (
    <ResponsivePanel title="Comments" onClose={() => navigate(-1)}>
      <KeyboardAvoidingView
        style={styles.panelRoot}
        keyboardVerticalOffset={0}
      >
        <View style={mergeStyles(styles.header, { paddingTop: topInset + 8 })}>
          <Pressable
            onPress={() => navigate(-1)}
            style={styles.headerBackButton}
            testID="comments-back-button"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Icon name="ArrowLeft" size={20} color={colors.text} />
          </Pressable>

          {property ? (
            <View style={styles.headerPropertyInfo}>
              {propertyImage.url ? (
                <PropertyImageSurface
                  source={{
                    listingPhotoUrl: (property as any).listingPhotoUrl ?? null,
                    aerialImageUrl: (property as any).aerialImageUrl ?? null,
                    countryCode: property.countryCode,
                  }}
                  style={styles.headerThumbnail as any}
                  markerSize={16}
                  imageTestID="comments-property-image"
                  markerTestID="comments-property-marker"
                />
              ) : null}
              <View style={styles.headerTextColumn}>
                <Text style={styles.headerAddress} numberOfLines={1}>{property.address}</Text>
                <Text style={styles.headerCity} numberOfLines={1}>
                  {property.city}
                  {property.postalCode ? `, ${property.postalCode}` : ''}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.subHeader}>
          <Text style={styles.commentCount}>
            {totalComments} {totalComments === 1 ? 'comment' : 'comments'}
          </Text>
          <SortToggle value={sortBy} onChange={setSortBy} />
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.goldDeep} />
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
                likedCommentIds={likedComments}
              />
            )}
            contentContainerStyle={styles.listContent}
            onEndReached={() => {
              if (hasNextPage && !isFetchingNextPage) {
                fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.5}
            ListFooterComponent={isFetchingNextPage ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={colors.goldDeep} />
              </View>
            ) : null}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            testID="comments-list"
          />
        )}

        <CommentInput
          onSubmit={handleSubmit}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          isAuthenticated={isAuthenticated}
          currentUsername={property ? `property-${property.id}` : undefined}
          variant="full"
          testID="comment-input"
        />
      </KeyboardAvoidingView>

      <AuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        message="Sign in to comment"
      />
    </ResponsivePanel>
  );
}

const styles = StyleSheet.create({
  panelRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPropertyInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerThumbnail: {
    width: 52,
    height: 52,
    borderRadius: 14,
  },
  headerTextColumn: {
    flex: 1,
  },
  headerAddress: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  headerCity: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  subHeader: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  commentCount: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  sortContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    padding: 4,
  },
  sortPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  sortPillActive: {
    backgroundColor: colors.gold,
  },
  sortText: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  sortTextActive: {
    color: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingMore: {
    paddingVertical: 16,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
});
