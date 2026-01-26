# Reference Expectation: Auth Modal Sign-In

## Overview

The authentication modal that appears when users attempt to perform actions that require authentication. Per the product spec, the app follows a "view-only without login, interactions gated at submit" pattern.

## Current Status

**IMPLEMENTATION STATUS: Component exists, integration incomplete**

The AuthModal component is fully implemented at `/apps/app/src/components/AuthModal.tsx` with:
- Google sign-in button (always shown)
- Apple sign-in button (iOS only)
- Brand section with logo
- Contextual message area
- Loading states
- Error handling

**Missing Integration:**
1. `PropertyBottomSheet` needs to pass `onAuthRequired` callback to `CommentsSection`
2. Main page (`index.web.tsx`) needs to render `AuthModal` component
3. Main page needs state management for `showAuthModal`
4. AuthModal `onClose` and `onSuccess` handlers need wiring

## Trigger Behavior

According to `agent-rules/main-spec.md`:
- Login via Google or Apple account
- View-only without login, interactions gated at submit
- Users can **start** a guess or comment without being logged in
- Login is required only at the **submit** moment (reduces friction, captures intent)
- "Save property" acts as the first conversion moment (requires login)

## Visual Requirements

### Modal Appearance
1. **Presentation**: Modal slides up from bottom (pageSheet style on mobile)
2. **Background**: Clean white background
3. **Header**:
   - Close button (X icon) on the left
   - "Sign In" title centered
   - Clean border separator

### Brand Section
1. **Logo**: HuisHype brand logo (orange square with "H")
2. **App Name**: "HuisHype" in bold
3. **Tagline**: "Social Real Estate" subtitle

### Message Area
- Contextual message explaining why sign-in is needed
- Examples: "Sign in to continue", "Sign in to post your comment", "Sign in to save this property"

### Sign-In Buttons
1. **Google Sign-In Button**:
   - White background with gray border
   - Google "G" logo icon
   - Text: "Continue with Google"
   - Full-width, rounded corners
   - Professional, recognizable styling

2. **Apple Sign-In Button** (iOS/native only):
   - Black background
   - White Apple logo icon
   - Text: "Continue with Apple"
   - Full-width, rounded corners
   - Follows Apple's Human Interface Guidelines

### Terms Section
- Small text at bottom
- Links to Terms of Service and Privacy Policy
- Non-intrusive, subtle styling

## Design Principles

1. **Clean & Minimal**: Does not feel intrusive or heavy
2. **Clear CTA**: Sign-in buttons are prominent and easy to tap
3. **Platform Guidelines**: Apple button follows official styling
4. **Trust**: Professional appearance builds user confidence
5. **Quick Dismissal**: Easy to close if user changes their mind

## Testing Considerations

1. Modal should appear when triggering auth-required actions:
   - Submitting a comment
   - Submitting a price guess
   - Saving/favoriting a property
   - Liking a comment

2. Modal should close on:
   - Tapping the X button
   - Successful authentication
   - Tapping outside the modal (backdrop)

3. Loading states should show when sign-in is in progress

## Reference Implementation

The current implementation is in `/apps/app/src/components/AuthModal.tsx`

## Integration Work Required

To complete this reference expectation, the following integration work is needed:

```tsx
// In PropertyBottomSheet.tsx, add onAuthRequired prop:
<CommentsSection
  property={propertyDetails}
  onAddComment={() => onCommentPress?.(propertyDetails.id)}
  onAuthRequired={onAuthRequired}  // Add this
/>

// In index.web.tsx, add AuthModal and state:
import { AuthModal } from '@/src/components';

const [showAuthModal, setShowAuthModal] = useState(false);

<AuthModal
  visible={showAuthModal}
  onClose={() => setShowAuthModal(false)}
  message="Sign in to continue"
  onSuccess={() => {
    setShowAuthModal(false);
    // Retry the action that required auth
  }}
/>
```
