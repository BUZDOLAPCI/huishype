import { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
  StyleSheet,
} from 'react-native';
import { Stack, router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/src/components/ui/Icon';
import { ResponsivePanel, type ResponsivePanelProps } from '@/src/components/ui/ResponsivePanel';
import {
  CommentCell,
  type CommentData as CommentCellData,
} from '@/src/components/CommentCell';
import { toCommentCellData } from '@/src/components/comment-cell-data';
import { CommentInput } from '@/src/components/CommentInput';
import { useProperty } from '@/src/hooks/useProperties';
import {
  useComments,
  useSubmitComment,
  useLikeComment,
  useDeleteComment,
  type Comment,
  type CommentSortBy,
} from '@/src/hooks/useComments';
import { useAuthContext } from '@/src/providers/AuthProvider';
import { AuthModal } from '@/src/components';
import { CommentSortToggle } from '@/src/components/Comments';
import { TAB_BAR_DOCK_HEIGHT } from '@/src/components/navigation/tabBarMetrics';
import { ReportModal } from '@/src/components/ReportModal';
import { PropertyImageSurface } from '@/src/components/PropertyImageSurface';
import {
  resolvePropertyImageWithType,
  toPropertyImageSource,
} from '@/src/utils/property-image';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import {
  buildPropertyRoute,
  normalizePropertyReturnTarget,
  toInternalAppHref,
} from '@/src/utils/property-route';
import { useT } from '@/src/i18n';
import { useIsLandscape } from '@/src/hooks/useIsLandscape';

export interface CommentsRouteScreenProps {
  propertyId?: string | null;
  returnTo?: string | string[] | null;
  onNavigate?: (path: string) => void;
  panelPresentation?: ResponsivePanelProps['presentation'];
}

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

export function CommentsRouteScreen({
  propertyId,
  returnTo,
  onNavigate,
  panelPresentation = 'route',
}: CommentsRouteScreenProps) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, user } = useAuthContext();
  const isLandscape = useIsLandscape();
  const hydratedNow = useHydratedNow();
  const normalizedReturnTarget = normalizePropertyReturnTarget(returnTo);
  const lastCloseAtRef = useRef(0);

  const [sortBy, setSortBy] = useState<CommentSortBy>('popular');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(
    null,
  );
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [reportCommentId, setReportCommentId] = useState<string | null>(null);

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
  const deleteMutation = useDeleteComment(propertyId ?? '');

  const allComments = useMemo(() => {
    if (!commentsData?.pages) return [];
    return commentsData.pages.flatMap((page) => page.data);
  }, [commentsData?.pages]);

  const commentsDisabled =
    property?.commentsDisabled === true ||
    commentsData?.pages[0]?.commentsDisabled === true;
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

      const targetComment = findCommentById(allComments, commentId);
      const isCurrentlyLiked = targetComment?.isLiked ?? false;

      likeMutation.mutate({ commentId, isCurrentlyLiked });
    },
    [allComments, isAuthenticated, likeMutation],
  );

  const handleReply = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return;
      }
      const comment = findCommentById(allComments, commentId);
      if (comment?.user) {
        setReplyTo({ id: commentId, username: comment.user.username });
      }
    },
    [isAuthenticated, allComments],
  );

  const handleSubmit = useCallback(
    (content: string) => {
      if (!isAuthenticated) {
        setShowAuthModal(true);
        return false;
      }
      submitMutation.mutate(
        { content, parentId: replyTo?.id },
        { onSuccess: () => setReplyTo(null) },
      );
      return true;
    },
    [isAuthenticated, replyTo?.id, submitMutation],
  );

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const handleDelete = useCallback(
    (commentId: string) => {
      deleteMutation.mutate(commentId, {
        onError: () => {
          Alert.alert(t('comments.delete.error'));
        },
      });
    },
    [deleteMutation, t],
  );

  const propertyImageSource = property ? toPropertyImageSource(property) : null;
  const propertyImage = propertyImageSource
    ? resolvePropertyImageWithType(propertyImageSource)
    : { url: null, type: 'placeholder' as const };

  const topInset = Platform.OS === 'web' ? 16 : insets.top;
  const composerBottomOffset = Platform.OS === 'web' && isLandscape
    ? 0
    : TAB_BAR_DOCK_HEIGHT;
  const navigateToTarget = useCallback(
    (targetHref: string) => {
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
    },
    [onNavigate],
  );

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
      navigateToTarget(buildPropertyRoute(property));
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

      <ResponsivePanel
        title={t('comments.title')}
        onClose={triggerClose}
        presentation={panelPresentation}
      >
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={[styles.header, { paddingTop: topInset + 8 }]}>
            <TouchableOpacity
              onPress={triggerClose}
              style={styles.headerBackButton}
              testID="comments-back-button"
              accessibilityRole="button"
              accessibilityLabel={t('common.goBack')}
              activeOpacity={0.8}
            >
              <Icon name="ArrowLeft" size={20} color="#3D3832" />
            </TouchableOpacity>

            {property && (
              <View style={styles.headerPropertyInfo}>
                {propertyImage.url && propertyImageSource && (
                  <PropertyImageSurface
                    source={propertyImageSource}
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
                    {property.city}
                    {property.postalCode ? `, ${property.postalCode}` : ''}
                  </Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.subHeader}>
            <Text style={styles.commentCount}>
              {t(totalComments === 1 ? 'comments.count.one' : 'comments.count.other', {
                count: totalComments,
              })}
            </Text>
            {commentsDisabled ? null : (
              <CommentSortToggle value={sortBy} onChange={setSortBy} />
            )}
          </View>

          {commentsDisabled ? (
            <View style={styles.disabledState}>
              <Icon name="ShieldCheck" size={28} color="#C7BFB3" />
              <Text style={styles.disabledText}>{t('comments.disabled')}</Text>
            </View>
          ) : isLoading ? (
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
                  onReport={setReportCommentId}
                  onDelete={handleDelete}
                  currentUserId={user?.id ?? null}
                />
              )}
              contentContainerStyle={[
                styles.listContent,
                { paddingBottom: insets.bottom + composerBottomOffset + 96 },
              ]}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.4}
              ListFooterComponent={
                isFetchingNextPage ? (
                  <ActivityIndicator size="small" color="#F5A623" />
                ) : null
              }
            />
          )}

          {commentsDisabled ? null : (
            <View
              style={[
                styles.composerDock,
                { bottom: insets.bottom + composerBottomOffset },
              ]}
            >
              <CommentInput
                onSubmit={handleSubmit}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                isAuthenticated={isAuthenticated}
                currentUsername={user?.username ?? user?.handle}
                currentUserDisplayName={user?.displayName}
                currentUserProfilePhotoUrl={user?.profilePhotoUrl ?? null}
              />
            </View>
          )}
        </KeyboardAvoidingView>
      </ResponsivePanel>

      <AuthModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
      {reportCommentId ? (
        <ReportModal
          visible
          target={{ type: 'comment', id: reportCommentId }}
          targetLabel={t('comments.reportTarget')}
          onClose={() => setReportCommentId(null)}
        />
      ) : null}
    </>
  );
}

export default CommentsRouteScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFBF5' },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8E0D4',
    gap: 14,
  },
  headerBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5EFE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPropertyInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerThumbnail: { width: 52, height: 52, borderRadius: 14, overflow: 'hidden' },
  headerTextColumn: { flex: 1, minWidth: 0 },
  headerAddress: { fontSize: 16, fontWeight: '600', color: '#2D2926' },
  headerCity: { fontSize: 13, color: '#8C8479', marginTop: 2 },
  subHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  commentCount: { fontSize: 14, fontWeight: '600', color: '#3D3832' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 20, gap: 12 },
  disabledState: {
    marginHorizontal: 20,
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
  composerDock: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
