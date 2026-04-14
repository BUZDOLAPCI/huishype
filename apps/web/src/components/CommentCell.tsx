import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icon';
import { UserAvatar, type AvatarSize } from './ui/UserAvatar';
import { KarmaBadge } from './Comments/KarmaBadge';

export type CommentCellVariant = 'compact' | 'full';

export interface CommentData {
  id: string;
  author: string;
  authorDisplayName?: string;
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
  likedCommentIds,
  testID,
}: CommentCellProps) {
  const [showReplies, setShowReplies] = useState(false);
  const [likePulse, setLikePulse] = useState(false);
  const pulseTimeoutRef = useRef<number | null>(null);
  const avatarSize: AvatarSize = isReply ? 'sm' : 'md';
  const isLiked = likedCommentIds ? likedCommentIds.has(comment.id) : !!comment.isLiked;

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current !== null) {
        window.clearTimeout(pulseTimeoutRef.current);
      }
    };
  }, []);

  const triggerLikePulse = useCallback(() => {
    if (pulseTimeoutRef.current !== null) {
      window.clearTimeout(pulseTimeoutRef.current);
    }

    setLikePulse(true);
    pulseTimeoutRef.current = window.setTimeout(() => {
      setLikePulse(false);
      pulseTimeoutRef.current = null;
    }, 180);
  }, []);

  const handleToggleReplies = useCallback(() => {
    onExpandReplies?.(comment.id);
    setShowReplies((prev) => !prev);
  }, [comment.id, onExpandReplies]);

  const hasReplies = comment.replies && comment.replies.length > 0;
  const hiddenReplyCount = comment.replyCount ?? (comment.replies?.length ?? 0);
  const displayName = comment.authorDisplayName || comment.author;

  return (
    <article
      className={`flex gap-2.5 py-3 ${isReply ? 'ml-3 border-l-2 border-warm-200 pl-3' : ''}`}
      data-testid={testID ?? (isReply ? 'comment-reply' : 'comment-cell')}
    >
      <UserAvatar
        username={comment.author}
        displayName={comment.authorDisplayName}
        size={avatarSize}
      />

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-warm-900">
                {displayName}
              </span>
              <KarmaBadge karma={comment.authorKarma} size="sm" />
            </div>
          </div>
          <time className="shrink-0 text-xs text-warm-400">{comment.createdAt}</time>
        </div>

        <p className="mb-2 whitespace-pre-wrap text-sm leading-5 text-warm-800">
          {comment.content}
        </p>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => {
              triggerLikePulse();
              onLike?.(comment.id);
            }}
            className="inline-flex min-h-11 min-w-11 items-center gap-1 py-2 text-left"
            data-testid="comment-like-button"
            aria-label={isLiked ? 'Unlike' : 'Like'}
            aria-pressed={isLiked}
          >
            <span
              className="inline-flex items-center justify-center transition-transform duration-150 ease-out"
              style={{ transform: `scale(${likePulse ? 1.15 : 1})` }}
            >
              <Icon
                name="Heart"
                size="sm"
                weight={isLiked ? 'fill' : 'regular'}
                color={isLiked ? '#FF6B35' : '#9C958A'}
              />
            </span>
            {comment.likeCount > 0 ? (
              <span className={`text-sm ${isLiked ? 'text-[#FF6B35]' : 'text-warm-500'}`}>
                {comment.likeCount}
              </span>
            ) : null}
          </button>

          {!isReply && variant === 'full' && (
            <button
              type="button"
              onClick={() => onReply?.(comment.id)}
              className="inline-flex min-h-11 min-w-11 items-center gap-1 py-2 text-left"
              data-testid="comment-reply-button"
              aria-label="Reply"
            >
              <Icon name="ChatCircle" size={16} color="#9C958A" />
              <span className="text-sm text-warm-500">Reply</span>
            </button>
          )}
        </div>

        {variant === 'full' && !isReply && hasReplies && (
          <div className="mt-2">
            {!showReplies && hiddenReplyCount > 0 && (
              <button
                type="button"
                onClick={handleToggleReplies}
                className="inline-flex items-center gap-2 text-sm text-warm-600"
                data-testid="view-replies-button"
              >
                <span className="h-px w-6 bg-warm-200" />
                <span>
                  View {hiddenReplyCount} {hiddenReplyCount === 1 ? 'reply' : 'replies'}
                </span>
                <Icon name="CaretDown" size={12} color="#9C958A" />
              </button>
            )}

            {showReplies && comment.replies?.map((reply) => (
              <CommentCell
                key={reply.id}
                comment={reply}
                variant={variant}
                isReply
                onLike={onLike}
                onReply={onReply}
                likedCommentIds={likedCommentIds}
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
