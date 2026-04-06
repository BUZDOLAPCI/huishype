import { useState, useCallback, useRef, useEffect } from 'react';
import { Pressable, Text, View, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KarmaBadge } from './KarmaBadge';
import { UserAvatar } from '../ui/UserAvatar';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';

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
  createdAt: string;
  replies?: CommentData[];
}

export interface CommentProps {
  comment: CommentData;
  onLike: (commentId: string) => void;
  onReply: (commentId: string, username: string) => void;
  isReply?: boolean;
  isLiked?: boolean;
  /** Set of comment IDs the current user has liked. Used to resolve liked state for replies. */
  likedCommentIds?: Set<string>;
}

/**
 * Format a date string to relative time (e.g., "2h ago", "3d ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
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
  isReply = false,
  isLiked = false,
  likedCommentIds,
}: CommentProps) {
  const [localIsLiked, setLocalIsLiked] = useState(isLiked);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotion();

  // Sync local state with prop when it changes
  useEffect(() => {
    setLocalIsLiked(isLiked);
  }, [isLiked]);

  const handleLike = useCallback(() => {
    // Animate the heart (skip when reduced motion is preferred)
    if (!reducedMotion) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.3,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();
    }

    setLocalIsLiked((prev) => !prev);
    onLike(comment.id);
  }, [comment.id, onLike, scaleAnim, reducedMotion]);

  const handleReply = useCallback(() => {
    onReply(comment.id, comment.user.username);
  }, [comment.id, comment.user.username, onReply]);

  const displayName = comment.user.displayName || comment.user.username;

  return (
    <View testID={isReply ? 'comment-reply' : 'comment'}>
      <View
        className={`py-3 ${isReply ? 'ml-10 pl-3 border-l-2 border-warm-200' : ''}`}
      >
        {/* Header: Avatar, Username, Badge, Timestamp */}
        <View className="flex-row items-center mb-2">
          <UserAvatar
            username={comment.user.username}
            displayName={comment.user.displayName ?? undefined}
            profilePhotoUrl={comment.user.profilePhotoUrl}
            size={isReply ? 'xs' : 'sm'}
          />
          <View className="ml-2 flex-1">
            <View className="flex-row items-center flex-wrap">
              <Text className="font-semibold text-warm-900 mr-1.5">
                {displayName}
              </Text>
              <KarmaBadge karma={comment.user.karma} size="sm" />
            </View>
            <Text className="text-xs text-warm-400 mt-0.5">
              @{comment.user.username}
            </Text>
          </View>
          <Text className="text-xs text-warm-400">
            {formatRelativeTime(comment.createdAt)}
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
            accessibilityLabel={localIsLiked ? 'Unlike comment' : 'Like comment'}
            accessibilityState={{ selected: localIsLiked }}
          >
            <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
              <Ionicons
                name={localIsLiked ? 'heart' : 'heart-outline'}
                size={18}
                color={localIsLiked ? '#EF4444' : '#9C958A'}
              />
            </Animated.View>
            <Text
              className={`ml-1 text-sm ${
                localIsLiked ? 'text-red-500' : 'text-warm-500'
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
              accessibilityLabel={`Reply to ${displayName}`}
            >
              <Ionicons name="chatbubble-outline" size={16} color="#9C958A" />
              <Text className="ml-1 text-sm text-warm-500">Reply</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Render Replies */}
      {!isReply && comment.replies && comment.replies.length > 0 && (
        <View>
          {comment.replies.map((reply) => (
            <Comment
              key={reply.id}
              comment={reply}
              onLike={onLike}
              onReply={onReply}
              isReply
              isLiked={likedCommentIds ? likedCommentIds.has(reply.id) : false}
              likedCommentIds={likedCommentIds}
            />
          ))}
        </View>
      )}
    </View>
  );
}
