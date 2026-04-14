import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './ui/Icon';
import { UserAvatar } from './ui/UserAvatar';

export type CommentInputVariant = 'compact' | 'full';

export interface ReplyTarget {
  id: string;
  username: string;
}

export interface CommentInputProps {
  /** Called when the user submits a comment. */
  onSubmit?: (content: string) => void;
  /** Reply-to target (shows indicator when set). */
  replyTo?: ReplyTarget | null;
  /** Called when the reply indicator is dismissed. */
  onCancelReply?: () => void;
  /** Whether the user is authenticated. */
  isAuthenticated?: boolean;
  /** Current user's username (for avatar display). */
  currentUsername?: string;
  /** Display variant. Default 'full'. */
  variant?: CommentInputVariant;
  /** Maximum character count. Default 500. */
  maxLength?: number;
  testID?: string;
}

export function CommentInput({
  onSubmit,
  replyTo,
  onCancelReply,
  isAuthenticated = false,
  currentUsername,
  variant = 'full',
  maxLength = 500,
  testID,
}: CommentInputProps) {
  const [content, setContent] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!replyTo) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [replyTo]);

  const handleSubmit = useCallback(() => {
    const trimmed = content.trim();
    if (!trimmed || !onSubmit || trimmed.length > maxLength || !isAuthenticated) {
      return;
    }

    onSubmit(trimmed);
    setContent('');
    inputRef.current?.blur();
  }, [content, isAuthenticated, maxLength, onSubmit]);

  const handleCancelReply = useCallback(() => {
    onCancelReply?.();
    setContent('');
  }, [onCancelReply]);

  const isOverLimit = content.length > maxLength;
  const isEmpty = content.trim().length === 0;
  const canSubmit = !isEmpty && !isOverLimit && isAuthenticated;

  const characterCountColor = isOverLimit
    ? 'text-red-500'
    : content.length > maxLength * 0.9
      ? 'text-amber-500'
      : 'text-warm-400';

  return (
    <div
      className={
        variant === 'full'
          ? 'border-t border-warm-200 bg-surface-card px-4 py-3'
          : 'pt-2'
      }
      data-testid={testID ?? 'comment-input'}
    >
      {replyTo && (
        <div
          className="mb-2 flex items-center rounded-lg bg-warm-100 px-3 py-2"
          data-testid="reply-indicator"
        >
          <Icon name="ArrowLeft" size={16} color="#9C958A" />
          <span className="ml-2 flex-1 truncate text-sm text-warm-600">
            Replying to <span className="font-semibold">@{replyTo.username}</span>
          </span>
          <button
            type="button"
            onClick={handleCancelReply}
            className="inline-flex items-center justify-center"
            data-testid="cancel-reply-button"
            aria-label="Cancel reply"
          >
            <Icon name="X" size={20} color="#C7BFB3" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {currentUsername && (
          <UserAvatar username={currentUsername} size="sm" />
        )}

        <div className="flex-1 rounded-xl bg-warm-100 px-4 py-2.5">
          <textarea
            ref={inputRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={
              isAuthenticated
                ? replyTo
                  ? `Reply to @${replyTo.username}...`
                  : 'Add a comment...'
                : 'Log in to comment...'
            }
            maxLength={maxLength + 50}
            disabled={!isAuthenticated}
            className="max-h-24 w-full resize-none border-0 bg-transparent text-base text-warm-900 outline-none placeholder:text-warm-400"
            rows={3}
          />

          <div className="mt-1 flex justify-end">
            <span className={`text-xs ${characterCountColor}`} data-testid="character-count">
              {content.length}/{maxLength}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${
            canSubmit ? 'bg-primary-500' : 'bg-warm-200'
          }`}
          data-testid="comment-send-button"
          aria-label="Send comment"
        >
          <Icon
            name="PaperPlaneTilt"
            size="sm"
            color={canSubmit ? '#FFFFFF' : '#C7BFB3'}
          />
        </button>
      </div>
    </div>
  );
}
