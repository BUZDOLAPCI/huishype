# Comments/guesses responsive panel

## Status

Resolved by the V2 URL UX overhaul.

## Note

This issue was written for the old route model that used deleted pages like `apps/app/app/comments/[propertyId].tsx` and `apps/app/app/guesses/[propertyId].tsx`. Those surfaces no longer exist.

The shipped canonical route architecture now enters through `apps/app/app/[...address].tsx` and renders the property subpages through the canonical address URLs:

- `/{address}/comments` -> `apps/app/src/screens/CommentsRouteScreen.tsx`
- `/{address}/guesses` -> `apps/app/src/screens/GuessesRouteScreen.tsx`

If responsive panel behavior needs to change in the future, the work should target the canonical route screens and shared route shell, not the deleted id-based pages.

## Historical context

The original note aimed to make comments and guesses open as a responsive side panel on wide web layouts while remaining full-screen on narrow/mobile layouts. That UX concern is now a historical reference only unless a new issue reopens it against the shipped V2 routes.
