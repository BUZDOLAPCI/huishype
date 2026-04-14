# Track liked state for comment replies

## Location

`apps/app/src/components/Comments/Comment.tsx:235`

```tsx
isLiked={false} // TODO: Track liked state for replies
```

## Problem

Parent comments track liked state via `likedComments` Set in the page component, but reply comments always pass `isLiked={false}`. The like button on replies fires the API call (via `onLike`) but the UI never reflects the toggled state.

## Fix

The `likedComments` Set in `apps/app/app/comments/[propertyId].tsx` already stores comment IDs for parent-level likes. Replies use the same `handleLike` callback and the same Set — the issue is that `Comment.tsx` doesn't receive the liked state for replies.

1. **`apps/app/src/components/Comments/Comment.tsx`** — The parent `Comment` component renders replies in a `.map()` loop but hardcodes `isLiked={false}`. Instead, accept a `likedCommentIds: Set<string>` prop (or a `isCommentLiked: (id: string) => boolean` callback) and pass `isLiked={likedCommentIds.has(reply.id)}` for each reply.

2. **`apps/app/app/comments/[propertyId].tsx`** — Pass `likedCommentIds={likedComments}` down through `CommentCell` → `Comment`.

3. **`apps/app/src/components/CommentCell.tsx`** — Thread the new prop through to `Comment`.

## Scope

- Small (~15 lines changed across 3 files)
- No new API calls needed — the Set and mutation already work for replies
- Add a unit test to `Comment.test.tsx` verifying replies render liked state
