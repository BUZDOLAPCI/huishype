import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';

export interface CommentInputProps {
  onSubmit: (content: string) => void;
  replyTo?: { id: string; username: string } | null;
  onCancelReply?: () => void;
  isSubmitting?: boolean;
  maxLength?: number;
  placeholder?: string;
}

/**
 * CommentInput component for browser rendering.
 */
export function CommentInput({
  onSubmit,
  replyTo,
  onCancelReply,
  isSubmitting = false,
  maxLength = 500,
  placeholder = 'Share your thoughts...',
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
    const trimmedContent = content.trim();
    if (trimmedContent.length === 0 || trimmedContent.length > maxLength) {
      return;
    }

    onSubmit(trimmedContent);
    setContent('');
    inputRef.current?.blur();
  }, [content, maxLength, onSubmit]);

  const handleCancelReply = useCallback(() => {
    onCancelReply?.();
    setContent('');
  }, [onCancelReply]);

  const isOverLimit = content.length > maxLength;
  const isEmpty = content.trim().length === 0;
  const canSubmit = !isEmpty && !isOverLimit && !isSubmitting;

  const characterCountColor = isOverLimit
    ? 'text-red-500'
    : content.length > maxLength * 0.9
      ? 'text-amber-500'
      : 'text-warm-400';

  return (
    <div className="border-t border-warm-200 bg-surface-card px-4 py-3">
      {replyTo && (
        <div
          className="mb-2 flex items-center rounded-lg bg-warm-100 px-3 py-2"
          data-testid="reply-indicator"
        >
          <Icon name="ArrowLeft" size={16} color="#9C958A" />
          <span className="ml-2 flex-1 text-sm text-warm-600">
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

      <div className="flex items-end">
        <div className="flex-1 rounded-xl bg-warm-100 px-4 py-2.5">
          <textarea
            ref={inputRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={replyTo ? `Reply to @${replyTo.username}...` : placeholder}
            maxLength={maxLength + 50}
            disabled={isSubmitting}
            className="max-h-24 w-full resize-none border-0 bg-transparent text-base text-warm-900 outline-none placeholder:text-warm-400"
            rows={3}
            data-testid="comment-input"
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
          className={`ml-2 inline-flex h-10 w-10 items-center justify-center rounded-full ${
            canSubmit ? 'bg-primary-500' : 'bg-warm-200'
          }`}
          data-testid="submit-button"
          aria-label="Submit comment"
        >
          {isSubmitting ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent text-warm-400" />
          ) : (
            <Icon name="PaperPlaneTilt" size={18} color={canSubmit ? '#FFFFFF' : '#C7BFB3'} />
          )}
        </button>
      </div>

      {isOverLimit && (
        <p className="mt-1 ml-1 text-xs text-red-500">
          Comment is too long. Please shorten it.
        </p>
      )}
    </div>
  );
}
