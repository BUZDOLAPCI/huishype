import { useCallback, useEffect, useRef, useState } from 'react';
import { KarmaBadge } from './KarmaBadge';
import { UserAvatar } from '../ui/UserAvatar';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';
import { useHydratedNow } from '@/src/hooks/useHydratedNow';

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
  isReply?: boolean;
  isLiked?: boolean;
}

/**
 * Format a date string to relative time (e.g. "2h ago", "3d ago").
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
 * Comment component for browser rendering.
 */
export function Comment({
  comment,
  onLike,
  onReply,
  isReply = false,
  isLiked = false,
}: CommentProps) {
  const reducedMotion = useReducedMotion();
  const hydratedNow = useHydratedNow();
  const [likePulse, setLikePulse] = useState(false);
  const pulseTimeoutRef = useRef<number | null>(null);
  const resolvedIsLiked = isLiked || !!comment.isLiked;

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current !== null) {
        window.clearTimeout(pulseTimeoutRef.current);
      }
    };
  }, []);

  const triggerLikePulse = useCallback(() => {
    if (reducedMotion) {
      return;
    }

    if (pulseTimeoutRef.current !== null) {
      window.clearTimeout(pulseTimeoutRef.current);
    }

    setLikePulse(true);
    pulseTimeoutRef.current = window.setTimeout(() => {
      setLikePulse(false);
      pulseTimeoutRef.current = null;
    }, 180);
  }, [reducedMotion]);

  const handleLike = useCallback(() => {
    triggerLikePulse();
    onLike(comment.id);
  }, [comment.id, onLike, triggerLikePulse]);

  const handleReply = useCallback(() => {
    onReply(comment.id, comment.user.username);
  }, [comment.id, comment.user.username, onReply]);

  const displayName = comment.user.displayName || comment.user.username;

  return (
    <article
      data-testid={isReply ? 'comment-reply' : 'comment'}
      className={`py-3 ${isReply ? 'ml-10 border-l-2 border-warm-200 pl-3' : ''}`}
    >
      <div className="mb-2 flex items-center">
        <UserAvatar
          username={comment.user.username}
          displayName={comment.user.displayName ?? undefined}
          profilePhotoUrl={comment.user.profilePhotoUrl}
          size={isReply ? 'xs' : 'sm'}
        />
        <div className="ml-2 min-w-0 flex-1">
          <div className="flex flex-wrap items-center">
            <span className="mr-1.5 font-semibold text-warm-900">{displayName}</span>
            <KarmaBadge karma={comment.user.karma} size="sm" />
          </div>
          <span className="mt-0.5 text-xs text-warm-400">@{comment.user.username}</span>
        </div>
        <time className="text-xs text-warm-400">
          {hydratedNow === null ? '\u00A0' : formatRelativeTime(comment.createdAt, hydratedNow)}
        </time>
      </div>

      <p className="mb-2 whitespace-pre-wrap leading-5 text-warm-800">{comment.content}</p>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleLike}
          className="inline-flex min-h-11 min-w-11 items-center py-2 text-left"
          data-testid="like-button"
          aria-label={resolvedIsLiked ? 'Unlike comment' : 'Like comment'}
          aria-pressed={resolvedIsLiked}
        >
          <span
            className="inline-flex items-center justify-center transition-transform duration-150 ease-out"
            style={{ transform: `scale(${likePulse ? 1.15 : 1})` }}
          >
            <Icon
              name="Heart"
              size={18}
              weight={resolvedIsLiked ? 'fill' : 'regular'}
              color={resolvedIsLiked ? '#EF4444' : '#9C958A'}
            />
          </span>
          <span
            className={`ml-1 text-sm ${
              resolvedIsLiked ? 'text-red-500' : 'text-warm-500'
            }`}
          >
            {comment.likeCount > 0 ? comment.likeCount : ''}
          </span>
        </button>

        {!isReply && (
          <button
            type="button"
            onClick={handleReply}
            className="inline-flex min-h-11 min-w-11 items-center py-2 text-left"
            data-testid="reply-button"
            aria-label={`Reply to ${displayName}`}
          >
            <Icon name="ChatCircle" size={16} color="#9C958A" />
            <span className="ml-1 text-sm text-warm-500">Reply</span>
          </button>
        )}
      </div>

      {!isReply && comment.replies && comment.replies.length > 0 && (
        <div>
          {comment.replies.map((reply) => (
            <Comment
              key={reply.id}
              comment={reply}
              onLike={onLike}
              onReply={onReply}
              isReply
              isLiked={reply.isLiked}
            />
          ))}
        </div>
      )}
    </article>
  );
}
