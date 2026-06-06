/**
 * CommentCell — Single comment display with author, karma badge, content, and actions.
 *
 * Design spec: Section 7.8 (Comments Page).
 *
 * Supports one-level reply threads: a parent comment can contain nested replies.
 * Replies are visually indented with a vertical thread line.
 *
 * Variants:
 *   compact — For preview/summary contexts (no reply expansion)
 *   full    — For full comment page with reply thread
 */

import React, { useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Icon } from './ui/Icon';
import { UserAvatar, type AvatarSize } from './ui/UserAvatar';
import { KarmaBadge } from './Comments/KarmaBadge';
import { CommentActionMenu } from './CommentActionMenu';
import { useT } from '@/src/i18n';

export type CommentCellVariant = 'compact' | 'full';

export interface CommentData {
  id: string;
  authorId?: string;
  author: string;
  authorDisplayName?: string;
  authorProfilePhotoUrl?: string | null;
  authorKarma: number;
  content: string;
  likeCount: number;
  isLiked?: boolean;
  createdAt: string;
  replies?: CommentData[];
  replyCount?: number;
}

export interface CommentCellProps {
  comment: CommentData;
  /** Display variant. Default 'full'. */
  variant?: CommentCellVariant;
  /** Whether this cell is rendering as a reply (indented). */
  isReply?: boolean;
  /** Called when the like button is pressed. */
  onLike?: (commentId: string) => void;
  /** Called when the reply button is pressed. */
  onReply?: (commentId: string) => void;
  /** Called when "View N replies" is pressed. */
  onExpandReplies?: (commentId: string) => void;
  /** Called from the long-press action menu. */
  onReport?: (commentId: string) => void;
  /** Set of comment IDs the current user has liked. Overrides comment.isLiked when provided. */
  likedCommentIds?: Set<string>;
  testID?: string;
}

export function CommentCell({
  comment,
  variant = 'full',
  isReply = false,
  onLike,
  onReply,
  onExpandReplies,
  onReport,
  likedCommentIds,
  testID,
}: CommentCellProps) {
  const t = useT();
  const [showReplies, setShowReplies] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const avatarSize: AvatarSize = isReply ? 'sm' : 'comment';
  const isLiked = likedCommentIds ? likedCommentIds.has(comment.id) : !!comment.isLiked;
  const displayName = comment.authorDisplayName || comment.author;

  const handleToggleReplies = () => {
    if (onExpandReplies) {
      onExpandReplies(comment.id);
    }
    setShowReplies((prev) => !prev);
  };

  const handleAuthorPress = () => {
    if (!comment.authorId) {
      return;
    }

    router.push(`/user/${comment.authorId}`);
  };

  const handleLongPress = () => {
    if (onReport) {
      setShowActionMenu(true);
    }
  };

  const handleReport = () => {
    onReport?.(comment.id);
  };

  const handleCopy = async () => {
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(comment.content);
  };

  const hasReplies = comment.replies && comment.replies.length > 0;
  const hiddenReplyCount = comment.replyCount ?? (comment.replies?.length ?? 0);

  return (
    <Pressable
      onLongPress={handleLongPress}
      style={[
        styles.container,
        isReply && styles.replyContainer,
      ]}
      testID={testID ?? (isReply ? 'comment-reply' : 'comment-cell')}
    >
      {/* Avatar */}
      {comment.authorId ? (
        <Pressable
          onPress={handleAuthorPress}
          accessibilityRole="link"
          accessibilityLabel={t('comments.openProfile', { name: displayName })}
          testID="comment-author-avatar-button"
        >
          <UserAvatar
            username={comment.author}
            displayName={comment.authorDisplayName}
            profilePhotoUrl={comment.authorProfilePhotoUrl}
            size={avatarSize}
          />
        </Pressable>
      ) : (
        <UserAvatar
          username={comment.author}
          displayName={comment.authorDisplayName}
          profilePhotoUrl={comment.authorProfilePhotoUrl}
          size={avatarSize}
        />
      )}

      {/* Content */}
      <View style={styles.threadColumn}>
        <View style={styles.contentRow}>
          <View style={styles.content}>
            {/* Header: name and karma badge */}
            <View style={styles.header}>
              <View style={styles.authorRow}>
                {comment.authorId ? (
                  <Pressable
                    onPress={handleAuthorPress}
                    accessibilityRole="link"
                    accessibilityLabel={t('comments.openProfile', { name: displayName })}
                    testID="comment-author-button"
                  >
                    <Text style={styles.authorName} numberOfLines={1}>
                      {displayName}
                    </Text>
                  </Pressable>
                ) : (
                  <Text style={styles.authorName} numberOfLines={1}>
                    {displayName}
                  </Text>
                )}
                <KarmaBadge karma={comment.authorKarma} size="sm" />
              </View>
            </View>

            {/* Comment text */}
            <Text style={styles.commentText}>{comment.content}</Text>

            {/* Meta row: timestamp and reply */}
            <View style={styles.metaRow}>
              <Text style={styles.timestamp}>{comment.createdAt}</Text>

              {!isReply && variant === 'full' && (
                <Pressable
                  onPress={() => onReply?.(comment.id)}
                  style={styles.replyButton}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  testID="comment-reply-button"
                  accessibilityRole="button"
                  accessibilityLabel={t('comments.reply')}
                >
                  <Text style={styles.replyText}>{t('comments.reply')}</Text>
                </Pressable>
              )}

              <View style={styles.metaSpacer} />

              <Pressable
                onPress={() => onLike?.(comment.id)}
                style={styles.likeButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="comment-like-button"
                accessibilityRole="button"
                accessibilityLabel={isLiked ? t('comments.unlikeAction') : t('comments.likeAction')}
              >
                <Icon
                  name="Heart"
                  size={22}
                  weight={isLiked ? 'fill' : 'regular'}
                  color={isLiked ? '#FF6B35' : '#8A8A8A'}
                />
                {comment.likeCount > 0 && (
                  <Text
                    style={[
                      styles.actionCount,
                      { color: isLiked ? '#FF6B35' : '#8A8A8A' },
                    ]}
                    numberOfLines={1}
                  >
                    {comment.likeCount}
                  </Text>
                )}
              </Pressable>
            </View>

            <CommentActionMenu
              visible={showActionMenu}
              onClose={() => setShowActionMenu(false)}
              onReport={handleReport}
              onCopy={handleCopy}
            />
          </View>
        </View>

        {/* Reply thread */}
        {variant === 'full' && !isReply && hasReplies && (
          <>
            {/* Show/hide replies toggle */}
            {!showReplies && hiddenReplyCount > 0 && (
              <Pressable
                onPress={handleToggleReplies}
                style={styles.viewRepliesButton}
                testID="view-replies-button"
              >
                <View style={styles.viewRepliesLine} />
                <Text style={styles.viewRepliesText}>
                  {t(
                    hiddenReplyCount === 1
                      ? 'comments.viewReplies.one'
                      : 'comments.viewReplies.other',
                    { count: hiddenReplyCount },
                  )}
                </Text>
                <Icon name="CaretDown" size={12} color="#8A8A8A" />
              </Pressable>
            )}

            {/* Rendered replies */}
            {showReplies && comment.replies?.map((reply) => (
              <CommentCell
                key={reply.id}
                comment={reply}
                variant={variant}
                isReply
                onLike={onLike}
                onReply={onReply}
                onReport={onReport}
                likedCommentIds={likedCommentIds}
              />
            ))}
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingVertical: 12,
    gap: 10,
  },
  replyContainer: {
    marginLeft: 12,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: '#F5F0E8',
  },
  threadColumn: {
    flex: 1,
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  authorName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9A9A9A',
  },
  timestamp: {
    fontSize: 12,
    color: '#9A9A9A',
  },
  commentText: {
    fontSize: 14,
    color: '#050505',
    lineHeight: 21,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  metaSpacer: {
    flex: 1,
  },
  replyButton: {
    minHeight: 24,
    justifyContent: 'center',
  },
  likeButton: {
    minWidth: 28,
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    transform: [{ translateY: -2 }],
  },
  actionCount: {
    fontSize: 13,
    fontWeight: '500',
  },
  replyText: {
    fontSize: 13,
    color: '#8A8A8A',
    fontWeight: '700',
  },
  // View replies
  viewRepliesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  viewRepliesLine: {
    width: 24,
    height: 1,
    backgroundColor: '#E8E0D4',
  },
  viewRepliesText: {
    fontSize: 12,
    color: '#8A8A8A',
    fontWeight: '700',
  },
});
