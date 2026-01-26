# Comments Section - Threaded Replies

## Overview

The comments section should provide a TikTok/Instagram Reels-inspired short-form comment feed experience within the property bottom sheet. Comments are fast, opinionated, and informal with lightweight social interactions.

## Visual Layout Requirements

### Header
- Section title "Comments" with a chat bubble icon (blue)
- Comment count badge showing total number of comments
- Sort toggle buttons (Recent | Popular) with pill-style toggle

### Comment List Display

Each comment should show:

1. **User Avatar** (left side)
   - Circular avatar with user initials or profile photo
   - Consistent background color based on username
   - Size: 32px for parent comments, 28px for replies

2. **User Info** (header row)
   - Display name (bold, gray-900)
   - Karma badge next to name showing user rank (Newbie, Regular, Trusted, Expert, Legend)
   - Username below in lighter text (@username format)
   - Timestamp on the right (relative time: "2h ago", "3d ago")

3. **Comment Content**
   - Text content with good line height for readability
   - Gray-800 text color

4. **Action Buttons** (below content)
   - Like button with heart icon (outline when not liked, filled red when liked)
   - Like count displayed next to heart
   - Reply button with chat bubble icon (only on parent comments)

### Threaded Replies

Replies should be visually indented under parent comments:
- Left margin of 40px (ml-10)
- Left border (2px gray line) to show thread connection
- Slightly smaller avatar (28px vs 32px)
- Reply button NOT shown on replies (1 level deep only, like TikTok/YouTube)

### Comment Input Area (Bottom)

- Text input field with placeholder "Share your thoughts..." (or "Log in to comment..." if not authenticated)
- Character count display (e.g., "0/500")
- Reply indicator showing which user is being replied to (if replying)
- Cancel reply button when replying

### Empty State

When no comments exist:
- Large chat bubble outline icon (gray)
- "No comments yet" text
- "Be the first to share your thoughts!" subtext

## Sorting Behavior

- **Recent**: Chronological, newest first
- **Popular**: Newer popular comments on top (engagement-weighted)
- Sort toggle should have visual indicator of active selection (white background, shadow)

## Acceptance Criteria

1. Comment list is visible with at least the following elements:
   - Section header with "Comments" title
   - Sort toggle (Recent/Popular)
   - Comment input area at bottom

2. Each comment displays:
   - User avatar
   - Username and karma badge
   - Timestamp
   - Comment text
   - Like button with count
   - Reply button (on parent comments only)

3. Threaded replies show:
   - Visual indentation (left margin + border)
   - Connection to parent comment
   - Same user info and like functionality

4. No console errors during render

## Reference Design

The design follows TikTok/Instagram Reels comment patterns:
- Lightweight, quick to scan
- Clear visual hierarchy
- Easy interaction targets
- Thread depth limited to 1 level
