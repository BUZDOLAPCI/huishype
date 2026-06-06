import type { Comment } from '@/src/hooks/useComments';
import { formatRelativeTime } from '@/src/components/Comments/Comment';
import type { CommentData as CommentCellData } from '@/src/components/CommentCell';

export function toCommentCellData(
  comment: Comment,
  hydratedNow: number | null,
): CommentCellData {
  return {
    id: comment.id,
    authorId: comment.user.id,
    author: comment.user.username,
    authorDisplayName: comment.user.displayName ?? undefined,
    authorProfilePhotoUrl: comment.user.profilePhotoUrl,
    authorKarma: comment.user.karma,
    content: comment.content,
    likeCount: comment.likeCount,
    isLiked: comment.isLiked,
    createdAt:
      hydratedNow === null
        ? '\u00A0'
        : formatRelativeTime(comment.createdAt, hydratedNow),
    replyCount: comment.replies?.length ?? 0,
    replies: comment.replies?.map((reply) => toCommentCellData(reply, hydratedNow)),
  };
}
