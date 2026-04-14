/**
 * Comments Page — Full-screen threaded comments view for a property.
 *
 * Design spec: Section 7.8 (Comments Page), Section 8.9 (Full Screen).
 *
 * Header with property thumbnail + address, sort toggle, scrollable
 * threaded comment list, and pinned input bar at bottom.
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  StyleSheet,
} from 'react-native';
import { Stack, router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/src/components/ui/Icon';
import { UserAvatar } from '@/src/components/ui/UserAvatar';
import { ResponsivePanel } from '@/src/components/ui/ResponsivePanel';
import { CommentCell, type CommentData as CommentCellData } from '@/src/components/CommentCell';
import { CommentInput } from '@/src/components/CommentInput';
import { useProperty } from '@/src/hooks/useProperties';
import {
  useComments,
  useSubmitComment,
  useLikeComment,
  type CommentSortBy,
  type Comment,
} from '@/src/hooks/useComments';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { AuthModal } from '@/src/components';
import { RouteLoadingShell } from '@/src/components/RouteLoadingShell';
import { PropertyImageSurface } from '@/src/components/PropertyImageSurface';
import { resolvePropertyImageWithType } from '@/src/utils/property-image';
import { formatRelativeTime } from '@/src/components/Comments/Comment';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import {
  buildPropertyRoute,
  normalizePropertyReturnTarget,
  toInternalAppHref,
} from '@/src/utils/property-route';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Map API Comment to CommentCell's CommentData shape */
function toCommentCellData(comment: Comment, hydratedNow: number | null): CommentCellData {
  return {
    id: comment.id,
    author: comment.user.username,
    authorDisplayName: comment.user.displayName ?? undefined,
    authorKarma: comment.user.karma,
    content: comment.content,
    likeCount: comment.likeCount,
    createdAt: hydratedNow === null ? '\u00A0' : formatRelativeTime(comment.createdAt, hydratedNow),
    replyCount: comment.replies?.length ?? 0,
    replies: comment.replies?.map((reply) => toCommentCellData(reply, hydratedNow)),
  };
}

// ─── Sort Toggle ─────────────────────────────────────────────────────────

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
        <Text style={[styles.sortText, value === 'popular' && styles.sortTextActive]}>
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

// ─── Main Screen ──────────────────────────────────────────────────────────

export interface CommentsRouteScreenProps {
  propertyId?: string | null;
  returnTo?: string | string[] | null;
  onNavigate?: (path: string) => void;
}

export function CommentsRouteScreen({
  propertyId,
  returnTo,
  onNavigate,
}: CommentsRouteScreenProps) {
  const insets = useSafeAreaInsets();
  const { isAuthenticated, user } = useAuthContext();
  const hydratedNow = useHydratedNow();
  const normalizedReturnTarget = normalizePropertyReturnTarget(returnTo);
  const lastCloseAtRef = useRef(0);

  const [sortBy, setSortBy] = useState<CommentSortBy>('popular');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Data fetching
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

  // Flatten pages
  const allComments = useMemo(() => {
    if (!commentsData?.pages) return [];
    return commentsData.pages.flatMap((page) => page.data);
  }, [commentsData?.pages]);

  const totalComments = commentsData?.pages[0]?.meta.total ?? 0;

  // Convert to CommentCell format
  const cellComments: CommentCellData[] = useMemo(
    () => allComments.map((comment) => toCommentCellData(comment, hydratedNow)),
    [allComments, hydratedNow]
  );

  // Handlers
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
    [isAuthenticated, likedComments, likeMutation]
  );

  const handleReply = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }
      const comment = allComments.find((c) => c.id === commentId);
      if (comment) {
        setReplyTo({ id: commentId, username: comment.user.username });
      }
    },
    [isAuthenticated, allComments]
  );

  const handleSubmit = useCallback(
    (content: string) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }
      submitMutation.mutate(
        { content, parentId: replyTo?.id },
        { onSuccess: () => setReplyTo(null) }
      );
    },
    [isAuthenticated, replyTo?.id, submitMutation]
  );

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Property image for header
  const propertyImage = property
    ? resolvePropertyImageWithType({
        listingPhotoUrl: (property as any).listingPhotoUrl ?? null,
        aerialImageUrl: (property as any).aerialImageUrl ?? null,
        countryCode: property.countryCode,
      })
    : { url: null, type: 'placeholder' as const };

  const topInset = Platform.OS === 'web' ? 16 : insets.top;
  const navigateToTarget = useCallback((targetHref: string) => {
    if (onNavigate) {
      onNavigate(targetHref);
      return;
    }

    const href = toInternalAppHref(targetHref);
    if (Platform.OS === 'web') {
      router.navigate(href);
      return;
    }

    router.replace(href);
  }, [onNavigate]);

  const navigateBackOrFallback = useCallback((fallbackHref: Href) => {
    if (router.canDismiss()) {
      router.dismiss();
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.dismissTo(fallbackHref);
  }, []);

  const handleClose = useCallback(() => {
    if (normalizedReturnTarget) {
      navigateToTarget(normalizedReturnTarget);
      return;
    }

    if (property) {
      const propertyRoute = buildPropertyRoute(property);
      navigateToTarget(propertyRoute);
      return;
    }

    if (Platform.OS !== 'web' && router.canDismiss()) {
      router.dismiss();
      return;
    }

    navigateBackOrFallback('/');
  }, [navigateBackOrFallback, navigateToTarget, normalizedReturnTarget, property]);

  const triggerClose = useCallback(() => {
    const now = Date.now();
    if (now - lastCloseAtRef.current < 250) {
      return;
    }

    lastCloseAtRef.current = now;
    handleClose();
  }, [handleClose]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <ResponsivePanel title="Comments" onClose={triggerClose}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          {/* Header */}
          <View style={[styles.header, { paddingTop: topInset + 8 }]}>
            <TouchableOpacity
              onPress={triggerClose}
              style={styles.headerBackButton}
              testID="comments-back-button"
              accessibilityRole="button"
              accessibilityLabel="Go back"
              activeOpacity={0.8}
            >
              <Icon name="ArrowLeft" size={20} color="#3D3832" />
            </TouchableOpacity>

          {/* Property thumbnail + address */}
          {property && (
            <View style={styles.headerPropertyInfo}>
              {propertyImage.url && (
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
              )}
              <View style={styles.headerTextColumn}>
                <Text style={styles.headerAddress} numberOfLines={1}>
                  {property.address}
                </Text>
                <Text style={styles.headerCity} numberOfLines={1}>
                  {property.city}{property.postalCode ? `, ${property.postalCode}` : ''}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* Comment count + sort toggle */}
        <View style={styles.subHeader}>
          <Text style={styles.commentCount}>
            {totalComments} {totalComments === 1 ? 'comment' : 'comments'}
          </Text>
          <SortToggle value={sortBy} onChange={setSortBy} />
        </View>

        {/* Comment list */}
        {isLoading ? (
          <RouteLoadingShell
            title="Loading comments"
            subtitle="Fetching the latest conversation..."
          />
        ) : (
          <FlatList
            data={cellComments}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.commentItem}>
                <CommentCell
                  comment={item}
                  variant="full"
                  onLike={handleLike}
                  onReply={handleReply}
                  likedCommentIds={likedComments}
                />
              </View>
            )}
            contentContainerStyle={styles.listContent}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              isFetchingNextPage ? (
                <ActivityIndicator
                  size="small"
                  color="#F5A623"
                  style={styles.loadMore}
                />
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Icon name="ChatCircle" size={48} color="#C7BFB3" />
                <Text style={styles.emptyTitle}>No comments yet</Text>
                <Text style={styles.emptySubtitle}>
                  Be the first to share your thoughts!
                </Text>
              </View>
            }
          />
        )}

        {/* Pinned input bar */}
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <CommentInput
            onSubmit={handleSubmit}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            isAuthenticated={isAuthenticated}
            currentUsername={user?.username}
            variant="full"
          />
          </View>
        </KeyboardAvoidingView>
      </ResponsivePanel>

      <AuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </>
  );
}

export default CommentsRouteScreen;

// ─── Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFBF5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F0E8',
    backgroundColor: '#FFFBF5',
    gap: 12,
  },
  headerBackButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F5F0E8',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  headerPropertyInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerThumbnail: {
    width: 48,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#F5F0E8',
  },
  headerTextColumn: {
    flex: 1,
  },
  headerAddress: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2D2926',
  },
  headerCity: {
    fontSize: 12,
    color: '#9C958A',
    marginTop: 1,
  },

  // Sub-header
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  commentCount: {
    fontSize: 15,
    fontWeight: '600',
    color: '#2D2926',
  },

  // Sort toggle
  sortContainer: {
    flexDirection: 'row',
    backgroundColor: '#EDECEA',
    borderRadius: 12,
    padding: 3,
    gap: 2,
  },
  sortPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#F5F0E8',
  },
  sortPillActive: {
    backgroundColor: '#F7C948',
  },
  sortText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#736C62',
  },
  sortTextActive: {
    fontWeight: '600',
    color: '#2D2926',
  },

  // Loading
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  commentItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#F5F0E8',
  },
  loadMore: {
    paddingVertical: 16,
  },

  // Empty
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#504A42',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9C958A',
  },

  // Input bar
  inputBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F5F0E8',
  },
});
