import { useState, useCallback, useMemo, useRef, useEffect } from 'react';

import type { SectionProps } from './types';
import { useComments, useSubmitComment, useLikeComment, type CommentSortBy, type Comment as CommentItem } from '../../hooks/useComments';
import { useAuthContext } from '../../providers/AuthProvider';
import type { AuthModalCopyInput } from '../../lib/authModalCopy';
import { SectionCard } from './SectionCard';
import { Icon } from '../ui/Icon';

interface CommentsSectionProps extends SectionProps {
  onAddComment?: () => void;
  onViewAll?: () => void;
  onAuthRequired?: (copy?: AuthModalCopyInput) => void;
}

const COMMENT_AUTH_REQUIRED_COPY = 'Sign in to post your comment' satisfies AuthModalCopyInput;

function formatRelativeTime(dateString: string, nowMs: number = Date.now()): string {
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

function getInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

function CommentComposer({
  onSubmit,
  replyTo,
  onCancelReply,
  isSubmitting = false,
  placeholder = 'Share your thoughts...',
}: {
  onSubmit: (content: string) => void;
  replyTo?: { id: string; username: string } | null;
  onCancelReply?: () => void;
  isSubmitting?: boolean;
  placeholder?: string;
}) {
  const [content, setContent] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (replyTo) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [replyTo]);

  const handleSubmit = useCallback(() => {
    const trimmed = content.trim();
    if (!trimmed || isSubmitting) {
      return;
    }
    onSubmit(trimmed);
    setContent('');
  }, [content, isSubmitting, onSubmit]);

  const canSubmit = content.trim().length > 0 && !isSubmitting;

  return (
    <div style={styles.composerWrap}>
      {replyTo ? (
        <div style={styles.replyIndicator} data-testid="reply-indicator">
          <Icon name="ArrowRight" size="xs" color="#9C958A" />
          <div style={styles.replyIndicatorText}>
            Replying to <strong>@{replyTo.username}</strong>
          </div>
          <button type="button" onClick={onCancelReply} style={styles.replyCancelButton} data-testid="cancel-reply-button">
            <Icon name="X" size="sm" color="#C7BFB3" />
          </button>
        </div>
      ) : null}

      <div style={styles.composerRow}>
        <textarea
          ref={inputRef}
          value={content}
          onChange={(event) => setContent(event.currentTarget.value)}
          placeholder={replyTo ? `Reply to @${replyTo.username}...` : placeholder}
          disabled={isSubmitting}
          rows={3}
          style={styles.commentInput}
          data-testid="comment-input"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            ...styles.submitButton,
            backgroundColor: canSubmit ? '#F5A623' : '#E8E0D4',
          }}
          data-testid="submit-button"
        >
          {isSubmitting ? <Icon name="Info" size="xs" color="#FFFFFF" /> : <Icon name="PaperPlaneTilt" size="xs" color={canSubmit ? '#FFFFFF' : '#C7BFB3'} />}
        </button>
      </div>
    </div>
  );
}

function CommentCard({
  comment,
  onLike,
  onReply,
  isReply = false,
}: {
  comment: CommentItem;
  onLike: (commentId: string) => void;
  onReply: (commentId: string, username: string) => void;
  isReply?: boolean;
}) {
  const displayName = comment.user.displayName || comment.user.username;

  return (
    <div style={{ ...styles.commentCard, ...(isReply ? styles.replyCard : null) }} data-testid={isReply ? 'comment-reply' : 'comment'}>
      <div style={styles.commentHeader}>
        <div style={styles.avatar}>{getInitials(displayName)}</div>
        <div style={styles.commentMeta}>
          <div style={styles.commentNameRow}>
            <span style={styles.commentName}>{displayName}</span>
            <span style={styles.karmaBadge}>{comment.user.karma} karma</span>
          </div>
          <div style={styles.commentUsername}>@{comment.user.username}</div>
        </div>
        <div style={styles.commentTime}>{formatRelativeTime(comment.createdAt)}</div>
      </div>

      <div style={styles.commentContent}>{comment.content}</div>

      <div style={styles.commentActions}>
        <button
          type="button"
          onClick={() => onLike(comment.id)}
          style={styles.commentActionButton}
          aria-label={comment.isLiked ? 'Unlike comment' : 'Like comment'}
          data-testid="like-button"
        >
          <Icon name={comment.isLiked ? 'Heart' : 'Heart'} size="xs" color={comment.isLiked ? '#EF4444' : '#9C958A'} />
          <span style={{ ...styles.commentActionText, color: comment.isLiked ? '#EF4444' : '#9C958A' }}>
            {comment.likeCount > 0 ? comment.likeCount : ''}
          </span>
        </button>

        {!isReply ? (
          <button
            type="button"
            onClick={() => onReply(comment.id, comment.user.username)}
            style={styles.commentActionButton}
            aria-label={`Reply to ${displayName}`}
            data-testid="reply-button"
          >
            <Icon name="ChatCircle" size="xs" color="#9C958A" />
            <span style={styles.commentActionText}>Reply</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CommentsList({
  comments,
  onLike,
  onReply,
}: {
  comments: CommentItem[];
  onLike: (commentId: string) => void;
  onReply: (commentId: string, username: string) => void;
}) {
  return (
    <div style={styles.commentList}>
      {comments.map((comment, index) => (
        <div key={comment.id}>
          {index > 0 ? <div style={styles.divider} /> : null}
          <CommentCard comment={comment} onLike={onLike} onReply={onReply} />
          {comment.replies.length > 0 ? (
            <div>
              {comment.replies.map((reply) => (
                <CommentCard
                  key={reply.id}
                  comment={reply}
                  onLike={onLike}
                  onReply={onReply}
                  isReply
                />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function CommentsSection({
  property,
  onAddComment,
  onViewAll,
  onAuthRequired,
}: CommentsSectionProps) {
  const [sortBy, setSortBy] = useState<CommentSortBy>('recent');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const [showAllComments, setShowAllComments] = useState(false);
  const { isAuthenticated } = useAuthContext();

  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useComments(property.id, sortBy);

  const submitMutation = useSubmitComment(property.id);
  const likeMutation = useLikeComment(property.id);

  const allComments = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.data);
  }, [data?.pages]);

  const displayedComments = showAllComments ? allComments : allComments.slice(0, 3);
  const totalComments = data?.pages[0]?.meta.total ?? property.commentCount;
  const hasMoreComments = allComments.length > 3 && !showAllComments;

  const handleLike = useCallback(
    (commentId: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.(COMMENT_AUTH_REQUIRED_COPY);
        return;
      }

      const targetComment = allComments.find((comment) => comment.id === commentId)
        ?? allComments.flatMap((comment) => comment.replies).find((reply) => reply.id === commentId);

      likeMutation.mutate({ commentId, isCurrentlyLiked: targetComment?.isLiked ?? false });
    },
    [allComments, isAuthenticated, likeMutation, onAuthRequired],
  );

  const handleReply = useCallback(
    (commentId: string, username: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.(COMMENT_AUTH_REQUIRED_COPY);
        return;
      }
      setReplyTo({ id: commentId, username });
    },
    [isAuthenticated, onAuthRequired],
  );

  const handleSubmit = useCallback(
    (content: string) => {
      if (!isAuthenticated) {
        onAuthRequired?.(COMMENT_AUTH_REQUIRED_COPY);
        return;
      }

      submitMutation.mutate(
        { content, parentId: replyTo?.id },
        { onSuccess: () => setReplyTo(null) },
      );
    },
    [isAuthenticated, onAuthRequired, replyTo?.id, submitMutation],
  );

  const handleViewAll = useCallback(() => {
    if (onViewAll) {
      onViewAll();
      return;
    }
    setShowAllComments(true);
    if (hasNextPage) {
      fetchNextPage();
    }
  }, [onViewAll, hasNextPage, fetchNextPage]);

  return (
    <SectionCard
      title="Comments"
      icon="ChatCircle"
      description="Read the neighborhood takes and add your own perspective on the address."
      trailing={totalComments > 0 ? (
        <div style={styles.commentBadge}>
          <span style={styles.commentBadgeText}>{totalComments}</span>
        </div>
      ) : null}
    >
      {totalComments > 0 ? (
        <div style={styles.sortWrap}>
          <button
            type="button"
            onClick={() => setSortBy('recent')}
            style={{ ...styles.sortChip, ...(sortBy === 'recent' ? styles.sortChipActive : null) }}
          >
            <span style={{ ...styles.sortText, ...(sortBy === 'recent' ? styles.sortTextActive : null) }}>Recent</span>
          </button>
          <button
            type="button"
            onClick={() => setSortBy('popular')}
            style={{ ...styles.sortChip, ...(sortBy === 'popular' ? styles.sortChipActive : null) }}
          >
            <span style={{ ...styles.sortText, ...(sortBy === 'popular' ? styles.sortTextActive : null) }}>Popular</span>
          </button>
        </div>
      ) : null}

      {isLoading ? (
        <div style={styles.stateWrap}>
          <div style={styles.stateIcon}><Icon name="Info" size={20} color="#F5A623" /></div>
          <div style={styles.stateText}>Loading comments...</div>
        </div>
      ) : null}

      {isError ? (
        <div style={styles.errorState}>
          <Icon name="WarningCircle" size={32} color="#EF4444" />
          <div style={styles.errorText}>Failed to load comments</div>
          <button type="button" onClick={() => refetch()} style={styles.retryButton}>Retry</button>
        </div>
      ) : null}

      {!isLoading && !isError && allComments.length === 0 ? (
        <div style={styles.emptyState}>
          <Icon name="ChatCircle" size={32} color="#C7BFB3" />
          <div style={styles.emptyTitle}>No comments yet</div>
          <div style={styles.emptyBody}>Be the first to share your thoughts!</div>
        </div>
      ) : null}

      {!isLoading && !isError && displayedComments.length > 0 ? (
        <CommentsList comments={displayedComments as CommentItem[]} onLike={handleLike} onReply={handleReply} />
      ) : null}

      {!isLoading && !isError && displayedComments.length > 0 && (hasMoreComments || hasNextPage) ? (
        <button type="button" onClick={handleViewAll} style={styles.loadMoreButton}>
          {isFetchingNextPage ? (
            <Icon name="Info" size="sm" color="#F5A623" />
          ) : (
            <span style={styles.loadMoreText}>
              {hasMoreComments ? `View all ${totalComments} comments` : 'Load more comments'}
            </span>
          )}
        </button>
      ) : null}

      <div style={styles.composerSection}>
        <CommentComposer
          onSubmit={handleSubmit}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          isSubmitting={submitMutation.isPending}
          placeholder={isAuthenticated ? 'Share your thoughts...' : 'Log in to comment...'}
        />
      </div>
    </SectionCard>
  );
}

const styles = {
  commentBadge: {
    minWidth: 28,
    padding: '5px 9px',
    borderRadius: 999,
    backgroundColor: '#FFF3DD',
    display: 'grid',
    placeItems: 'center',
  },
  commentBadgeText: {
    fontSize: 11,
    fontWeight: 700,
    color: '#C18A10',
  },
  sortWrap: {
    display: 'inline-flex',
    backgroundColor: '#FBF4E7',
    borderRadius: 999,
    padding: 3,
    marginBottom: 14,
    gap: 4,
  },
  sortChip: {
    border: 'none',
    background: 'transparent',
    padding: '7px 12px',
    borderRadius: 999,
    cursor: 'pointer',
  },
  sortChipActive: {
    backgroundColor: '#FFFFFF',
  },
  sortText: {
    fontSize: 12,
    fontWeight: 600,
    color: '#8C8479',
  },
  sortTextActive: {
    color: '#2D2926',
  },
  commentList: {
    borderRadius: 16,
    overflow: 'hidden',
    border: '1px solid #F5EBDD',
    backgroundColor: '#FFFCF7',
  },
  divider: {
    height: 1,
    backgroundColor: '#F5EBDD',
  },
  commentCard: {
    padding: '12px 14px',
  },
  replyCard: {
    marginLeft: 40,
    borderLeft: '2px solid #F5EBDD',
    paddingLeft: 12,
  },
  commentHeader: {
    display: 'grid',
    gridTemplateColumns: '32px 1fr auto',
    gap: 8,
    alignItems: 'start',
    marginBottom: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: '#FFF3DD',
    color: '#B47712',
    display: 'grid',
    placeItems: 'center',
    fontSize: 12,
    fontWeight: 700,
  },
  commentMeta: {
    minWidth: 0,
  },
  commentNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  commentName: {
    fontWeight: 700,
    color: '#2D2926',
  },
  karmaBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: '#8C8479',
    backgroundColor: '#F5F0E8',
    padding: '2px 6px',
    borderRadius: 999,
  },
  commentUsername: {
    fontSize: 12,
    color: '#8C8479',
    marginTop: 2,
  },
  commentTime: {
    fontSize: 12,
    color: '#B0A79D',
    whiteSpace: 'nowrap',
  },
  commentContent: {
    color: '#736C62',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
  },
  commentActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  commentActionButton: {
    border: 'none',
    background: 'transparent',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '8px 0',
    cursor: 'pointer',
  },
  commentActionText: {
    fontSize: 13,
    fontWeight: 600,
  },
  composerSection: {
    marginTop: 12,
  },
  composerWrap: {
    borderTop: '1px solid #F5EBDD',
    backgroundColor: '#FFFFFF',
    paddingTop: 12,
  },
  replyIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    backgroundColor: '#F5F0E8',
    borderRadius: 10,
    padding: '8px 12px',
  },
  replyIndicatorText: {
    flex: 1,
    fontSize: 13,
    color: '#736C62',
  },
  replyCancelButton: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
  },
  composerRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 40px',
    gap: 8,
    alignItems: 'end',
  },
  commentInput: {
    width: '100%',
    minHeight: 84,
    resize: 'vertical',
    borderRadius: 12,
    border: '1px solid #E8E0D4',
    backgroundColor: '#FBF8F2',
    padding: '12px 14px',
    font: 'inherit',
    color: '#2D2926',
    boxSizing: 'border-box',
  },
  submitButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    border: 'none',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
  },
  stateWrap: {
    display: 'grid',
    justifyItems: 'center',
    gap: 8,
    padding: '24px 0',
  },
  stateIcon: {
    width: 32,
    height: 32,
    display: 'grid',
    placeItems: 'center',
  },
  stateText: {
    color: '#736C62',
    fontSize: 14,
  },
  errorState: {
    display: 'grid',
    justifyItems: 'center',
    gap: 8,
    padding: '18px 0',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
  },
  retryButton: {
    border: 'none',
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    color: '#B91C1C',
    padding: '8px 12px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  emptyState: {
    display: 'grid',
    justifyItems: 'center',
    gap: 8,
    padding: '20px 0',
    backgroundColor: '#FFFCF7',
    borderRadius: 12,
  },
  emptyTitle: {
    color: '#736C62',
    fontSize: 15,
    fontWeight: 700,
  },
  emptyBody: {
    color: '#AEA699',
    fontSize: 13,
  },
  loadMoreButton: {
    width: '100%',
    border: 'none',
    borderTop: '1px solid #F5EBDD',
    background: 'transparent',
    padding: '12px 0',
    cursor: 'pointer',
    display: 'grid',
    placeItems: 'center',
  },
  loadMoreText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: 600,
  },
} as const;
