# Reactions/Likes System - Visual Expectation

## Overview

The reactions and likes system should provide fast, satisfying social interactions across the platform. Users should be able to quickly express interest in properties and engage with comments.

## Reference: Main Spec Requirements

From the product specification:

- **Quick Action Buttons on property preview**: Like/Upvote, Comment, Guess
- **Like should feel as fast as double-tapping on Instagram** - instant feedback, optimistic UI
- **Lightweight reactions (likes, reacts) on comments** - TikTok/Instagram style
- **Multiple reaction types supported**: like, love, wow, angry (for future expansion)

## Visual Requirements

### 1. Property Preview Card - Quick Actions Bar

The property preview card (shown when tapping a property on the map) should display:

- **Like button**: Heart icon with "Like" text
- **Comment button**: Chat bubble icon with "Comment" text
- **Guess button**: Price tag icon with "Guess" text
- All buttons in a horizontal row with equal spacing
- Separated from property info by a subtle border/divider
- Touch target area large enough for easy tapping (min 44px)

### 2. Property Bottom Sheet - Quick Actions

The full property bottom sheet should have prominent action buttons:

- **Save button**: Bookmark icon, toggles filled/outline state
- **Share button**: Share icon for sharing the property
- **Like/Favorite button**: Heart icon with "Like/Liked" text
- Visual feedback when toggled (color change, icon fill)
- Count display when likes > 0

### 3. Comment Like Button

Each comment should display:

- **Heart icon** to the left of the like count
- **Like count** (hidden or "0" when no likes, number when > 0)
- **Filled heart (red)** when user has liked
- **Outline heart (gray)** when not liked
- **Animation on tap**: Quick scale bounce (heart grows then returns to normal size)

### 4. Like Button States

**Unliked State:**
- Heart outline icon
- Gray color (#6B7280)
- "Like" text label

**Liked State:**
- Filled heart icon
- Red color (#EF4444)
- "Liked" text label (or just different styling)

### 5. Animation Feedback

When user taps like:

1. **Instant visual feedback**: Heart fills immediately (optimistic UI)
2. **Scale animation**: Heart briefly grows 1.3x then returns to normal
3. **Color transition**: Smooth change from gray to red (or vice versa)
4. **Haptic feedback** (on native): Light tap sensation

### 6. Layout Specifications

Quick Actions bar layout:
- Horizontal row, evenly distributed
- Padding: 12-16px vertical, 16px horizontal from container edges
- Icon size: 20-22px
- Text size: 14px (sm)
- Gap between icon and text: 4-8px (ml-1 or ml-2)
- Active/pressed state: Background color change (bg-gray-100)

## Verification Criteria

1. Quick actions bar is visible on property preview cards
2. Like button shows correct icon (heart) and label
3. Like button is positioned alongside Comment and Guess buttons
4. Bottom sheet shows Save, Share, and Like/Favorite actions
5. Comment like buttons display with proper icon and count
6. No console errors during interaction
7. Touch targets are adequate size for mobile interaction

## Current Implementation Status

The codebase already has:
- `PropertyPreviewCard.tsx` with Like, Comment, Guess quick actions
- `QuickActions.tsx` in PropertyBottomSheet with Save, Share, Favorite
- `Comment.tsx` with animated like button and like count display
- Reaction types defined in `packages/shared/src/types/reaction.ts`

The visual test should capture the property preview card with quick actions visible to verify the reactions/likes UI is implemented correctly.
