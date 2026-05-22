import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View, Animated, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { KarmaBadge } from './KarmaBadge';
import { UserAvatar } from '../ui/UserAvatar';
import { CommentActionMenu } from '../CommentActionMenu';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';
import { useT } from '@/src/i18n';

export interface CommentUser {
  id: string;
  username: string;
  displayName: string | null;
  profilePhotoUrl: string | null;
  karma: number;
}

export interface CommentData {
  id: string;
  content: string;
  user: CommentUser;
  likeCount: number;
  isLiked?: boolean;
  createdAt: string;
  replies?: CommentData[];
}

export interface CommentProps {
  comment: CommentData;
  onLike: (commentId: string) => void;
  onReply: (commentId: string, username: string) => void;
  onReport?: (commentId: string) => void;
  isReply?: boolean;
  isLiked?: boolean;
}

/**
 * Format a date string to relative time (e.g., "2h ago", "3d ago")
 */
export function formatRelativeTime(dateString: string, nowMs: number = Date.now()): string {
  const date = new Date(dateString);
  const diffMs = nowMs - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `${diffYears}y ago`;
  if (diffMonths > 0) return `${diffMonths}mo ago`;
  if (diffWeeks > 0) return `${diffWeeks}w ago`;
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return 'just now';
}

/**
 * Comment Component
 * Displays a single comment with user info, content, and actions
 */
export function Comment({
  comment,
  onLike,
  onReply,
  onReport,
  isReply = false,
  isLiked = false,
}: CommentProps) {
  const t = useT();
  const [showActionMenu, setShowActionMenu] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();
  const hydratedNow = useHydratedNow();
  const resolvedIsLiked = isLiked || !!comment.isLiked;

  const handleLike = useCallback(() => {
    // Animate the heart (skip when reduced motion is preferred)
    if (!reducedMotion) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.3,
          duration: 100,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 100,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start();
    }

    onLike(comment.id);
  }, [comment.id, onLike, scaleAnim, reducedMotion]);

  const handleReply = useCallback(() => {
    onReply(comment.id, comment.user.username);
  }, [comment.id, comment.user.username, onReply]);

  const handleAuthorPress = useCallback(() => {
    router.push(`/user/${comment.user.id}`);
  }, [comment.user.id]);

  const handleLongPress = useCallback(() => {
    if (onReport) {
      setShowActionMenu(true);
    }
  }, [onReport]);

  const handleReport = useCallback(() => {
    onReport?.(comment.id);
  }, [comment.id, onReport]);

  const handleCopy = useCallback(async () => {
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(comment.content);
  }, [comment.content]);

  const displayName = comment.user.displayName || comment.user.username;

  return (
    <View testID={isReply ? 'comment-reply' : 'comment'}>
      <Pressable
        onLongPress={handleLongPress}
        className={`py-3 ${isReply ? 'ml-10 pl-3 border-l-2 border-warm-200' : ''}`}
        testID={isReply ? 'comment-reply-long-press-target' : 'comment-long-press-target'}
      >
        {/* Header: Avatar, Username, Badge, Timestamp */}
        <View className="flex-row items-center mb-2">
          <Pressable
            onPress={handleAuthorPress}
            testID="comment-author-avatar-button"
            accessibilityRole="link"
            accessibilityLabel={t('comments.openProfile', { name: displayName })}
          >
            <UserAvatar
              username={comment.user.username}
              displayName={comment.user.displayName ?? undefined}
              profilePhotoUrl={comment.user.profilePhotoUrl}
              size={isReply ? 'xs' : 'sm'}
            />
          </Pressable>
          <View className="ml-2 flex-1">
            <Pressable
              onPress={handleAuthorPress}
              testID="comment-author-button"
              accessibilityRole="link"
              accessibilityLabel={t('comments.openProfile', { name: displayName })}
            >
              <View className="flex-row items-center flex-wrap">
                <Text className="font-semibold text-warm-900 mr-1.5">
                  {displayName}
                </Text>
                <KarmaBadge karma={comment.user.karma} size="sm" />
              </View>
              <Text className="text-xs text-warm-400 mt-0.5">
                @{comment.user.username}
              </Text>
            </Pressable>
          </View>
          <Text className="text-xs text-warm-400">
            {hydratedNow === null ? '\u00A0' : formatRelativeTime(comment.createdAt, hydratedNow)}
          </Text>
        </View>

        {/* Comment Content */}
        <Text className="text-warm-800 mb-2 leading-5">{comment.content}</Text>

        {/* Actions: Like, Reply */}
        <View className="flex-row items-center gap-4">
          <Pressable
            onPress={handleLike}
            className="flex-row items-center"
            style={{ minHeight: 44, minWidth: 44, paddingVertical: 8 }}
            hitSlop={4}
            testID="like-button"
            accessibilityRole="button"
            accessibilityLabel={resolvedIsLiked ? t('comments.unlike') : t('comments.like')}
            accessibilityState={{ selected: resolvedIsLiked }}
          >
            <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
              <Ionicons
                name={resolvedIsLiked ? 'heart' : 'heart-outline'}
                size={18}
                color={resolvedIsLiked ? '#EF4444' : '#9C958A'}
              />
            </Animated.View>
            <Text
              className={`ml-1 text-sm ${
                resolvedIsLiked ? 'text-red-500' : 'text-warm-500'
              }`}
            >
              {comment.likeCount > 0 ? comment.likeCount : ''}
            </Text>
          </Pressable>

          {!isReply && (
            <Pressable
              onPress={handleReply}
              className="flex-row items-center"
              style={{ minHeight: 44, minWidth: 44, paddingVertical: 8 }}
              hitSlop={4}
              testID="reply-button"
              accessibilityRole="button"
              accessibilityLabel={t('comments.replyTo', { name: displayName })}
            >
              <Ionicons name="chatbubble-outline" size={16} color="#9C958A" />
              <Text className="ml-1 text-sm text-warm-500">{t('comments.reply')}</Text>
            </Pressable>
          )}
        </View>
        <CommentActionMenu
          visible={showActionMenu}
          onClose={() => setShowActionMenu(false)}
          onReport={handleReport}
          onCopy={handleCopy}
        />
      </Pressable>

      {/* Render Replies */}
      {!isReply && comment.replies && comment.replies.length > 0 && (
        <View>
          {comment.replies.map((reply) => (
            <Comment
              key={reply.id}
              comment={reply}
              onLike={onLike}
              onReply={onReply}
              onReport={onReport}
              isReply
              isLiked={reply.isLiked}
            />
          ))}
        </View>
      )}
    </View>
  );
}
