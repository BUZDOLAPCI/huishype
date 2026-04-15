# Track liked state for comment replies

## Status

Fixed in the V2 canonical route overhaul. The old comments host route no longer exists, so this note is historical rather than an active implementation task.

## Route ownership

Comment flows now enter through `apps/app/app/[...address].tsx` and render in `apps/app/src/screens/CommentsRouteScreen.tsx`. The deleted `apps/app/app/comments/[propertyId].tsx` host route should not be referenced anymore.

## Original issue

Parent comments tracked liked state via a `likedComments` set, but reply comments were hardcoded to `isLiked={false}`. The like button still fired the API call, but the UI did not reflect the toggled state for replies.

## Note

This was resolved during the route migration. Keep any future reply-like-state work on the canonical comments route stack instead of the removed host-page implementation.
