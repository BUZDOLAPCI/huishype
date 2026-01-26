# Consensus Alignment Feedback

## Overview

Based on the main specification (agent-rules/main-spec.md), the Consensus Alignment Feedback feature provides immediate feedback to users after they submit a price guess, showing how their guess aligns with the crowd consensus. This creates a "small dopamine hit" without revealing right/wrong prematurely.

From the spec:
> "Consensus Alignment Feedback: Show users immediately if their guess aligns with crowd consensus (e.g., 'You agree with 90% of top predictors'). This provides a small dopamine hit without revealing right/wrong prematurely. It also provokes users with outlier positions to comment and defend their view."

## Expected Visual Elements

### 1. Consensus Alignment Visualization

After a user submits their price guess, show a visual feedback component that includes:

- **Icon**: A contextual icon that reflects the alignment status
  - Checkmark circle (green) for aligned guesses
  - Information circle (blue) for close guesses
  - Trending up (amber) for different guesses

- **Color-coded Background**: The feedback container should have a background color indicating alignment:
  - Green (aligned): Within 5% of crowd estimate
  - Blue (close): Within 5-15% of crowd estimate
  - Amber/Orange (different): More than 15% different from crowd estimate

### 2. Percentile Ranking Display

- Show where the user's guess ranks among all predictions
- Example: "Your guess is higher than 75% of predictions"
- This gives users context about how their opinion compares to others

### 3. Agreement Percentage

- For aligned guesses: "You agree with 90% of top predictors"
- Display a percentage bar showing alignment level
- The percentage reflects agreement with credible/top predictors, not just raw average

### 4. Visual Feedback Categories

Three distinct states should be clearly differentiated:

**Aligned (Green)**:
- User's guess is within 5% of crowd estimate
- Message: "You agree with X% of top predictors"
- Progress bar showing high alignment percentage
- Celebratory/positive visual tone

**Close (Blue)**:
- User's guess is within 5-15% of crowd estimate
- Message: "Your guess is close to the crowd consensus"
- Progress bar showing moderate alignment
- Informative/neutral visual tone

**Different (Amber/Orange)**:
- User's guess is more than 15% different from crowd estimate
- Message: "Your guess is X% above/below the crowd estimate"
- Shows price comparison between user guess and crowd estimate
- Provocative tone to encourage commenting/defending the position

### 5. Encouraging Messaging

The messaging should gamify the experience:
- Positive reinforcement for aligned guesses
- Curiosity-provoking messaging for outlier positions
- Social proof elements (referencing "top predictors")
- Invite outliers to comment and defend their view

### 6. Animation/Feedback

- Smooth slide-in animation when the component appears
- Icon should have a bounce/scale animation
- Text should fade in after the container appears
- Haptic feedback on mobile devices for satisfying tactile response

## Implementation Notes

The component should:
1. Appear after a successful guess submission in the PropertyBottomSheet
2. Be visually prominent but not obstructive
3. Include the guess count to show social proof ("Based on X guesses")
4. Display clearly alongside the FMV Visualization component
5. Animate in with spring physics for a playful feel

## Test Criteria

A valid screenshot should show:
1. The PropertyBottomSheet expanded to show the price guess section
2. The ConsensusAlignment component visible with appropriate styling
3. At least one of the three states (aligned/close/different) clearly displayed
4. The message text, percentage, and guess count visible
5. The FMV Visualization context (crowd estimate, distribution bar)
