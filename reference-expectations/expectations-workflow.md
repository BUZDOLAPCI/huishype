# Reference Expectations System

This document explains how to create and use reference expectations for agent-driven development. Reference expectations define desired outcomes (visual, functional, or behavioral) that agents work towards iteratively until the implementation matches the expectation.

## What is a Reference Expectation?

A reference expectation is a specification of what the application should look like or how it should behave. It consists of:

1. **A named folder** under `reference-expectations/` (e.g., `map-visuals-close-up/`)
2. **An `expectation.md` file** describing what is expected
3. **Optional reference images** showing visual examples to match

Agents use these expectations as targets. They implement, screenshot, compare using thinking vision models, and iterate until the current state matches the expectation.

## How the System Works

### The Iteration Loop

When an agent is asked to "work on reference expectation X", it executes this loop:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ ANALYZE  │───>│ IMPLEMENT│───>│  VERIFY  │───>│  TESTS   │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       ^                               │               │         │
│       │                               │               │         │
│       │         NEEDS_WORK            │    FAIL       │         │
│       └───────────────────────────────┴───────────────┘         │
│                                                                 │
│                          SUFFICIENT + ALL TESTS GREEN           │
│                                    │                            │
│                                    v                            │
│                              ┌──────────┐                       │
│                              │ COMPLETE │                       │
│                              └──────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

1. **Analyze**: Read the expectation, examine reference images, compare to current state
2. **Implement**: Make code changes, create/update e2e test, generate screenshot
3. **Verify**: Compare screenshot to reference, check console health
4. **Tests**: Run full test suite to ensure no regressions
5. **Loop or Complete**: If insufficient, repeat with feedback; if sufficient, mark done

### Generated Artifacts

When working on an expectation, the system generates:

- **E2E test**: `apps/app/e2e/visual/reference-{name}.spec.ts`
- **Screenshot**: `test-results/reference-expectations/{name}/{name}-current.png`

These allow visual comparison between current implementation and reference.

## Creating a New Expectation

### Step 1: Create the Folder

Create a new folder under `reference-expectations/` with a **numbered prefix** and descriptive kebab-case name:

```
reference-expectations/
└── NNNN-your-expectation-name/
    ├── expectation.md
    └── reference-image.png (optional)
```

**Numbering convention:**
- All folders start with a 4-digit number prefix: `0000-`, `0001-`, `0002-`, etc.
- Use the **next available number** in sequence
- To find the next number, check existing folders: `ls reference-expectations/ | grep "^[0-9]" | tail -1`
- Example: if the highest is `0020-backend-vector-tile-clustering`, the next is `0021-your-new-expectation`

**Naming conventions:**
- Format: `NNNN-kebab-case-name` (e.g., `0021-dark-mode-toggle`)
- Use kebab-case after the number: `price-guess-slider-ui`, `map-visuals-close-up`
- Be descriptive: the name should hint at what's being specified
- Keep it concise: 2-5 words typically works well

### Step 2: Write expectation.md

The `expectation.md` file is the core of your expectation. It can range from informal to highly structured depending on complexity.

#### Minimal Format (for simple expectations)

```markdown
When [trigger/context], the app should [expected behavior].

[Description of visual/functional requirements]

Reference image: [filename] shows [what the image demonstrates]
```

#### Structured Format (for complex expectations)

```markdown
# [Feature Name] - Reference Expectation

## Overview

[1-2 sentence summary of what this expectation covers]

## Requirements

### [Requirement Category 1]
- Requirement detail
- Requirement detail

### [Requirement Category 2]
- Requirement detail

## Visual Elements Required

### 1. [Element Name]
- Visual description
- Styling notes
- Positioning

### 2. [Element Name]
...

## Interaction Behavior

[How the feature responds to user actions]

## Acceptance Criteria (SUFFICIENT)

1. [Criterion 1]
2. [Criterion 2]
...

## Acceptance Criteria (NEEDS_WORK)

Mark as NEEDS_WORK if:
- [Failure condition 1]
- [Failure condition 2]
```

### Step 3: Add Reference Images (Optional but Recommended)

Reference images provide visual targets for agents. They can be:

- **Screenshots** from similar apps (Funda, Instagram, Google Maps, etc.)
- **Mockups** from design tools (Figma, Sketch)
- **Sketches** or wireframes
- **Existing app screenshots** showing desired state

**Image guidelines:**
- Use common formats: `.png`, `.jpg`, `.jpeg`
- Name descriptively: `close-up-map-visuals.jpeg`, `funda-paged-group-previews.jpeg`
- Reference images in your `expectation.md`: "See `filename.png` for an example"
- Multiple images are allowed for different aspects or states

## Best Practices

### Writing Good Expectations

**1. Be Specific About What Matters**

Bad:
> The map should look nice.

Good:
> The map should show 3D building extrusions with soft shadows. Buildings should be white/off-white/beige. Roads, trees, and greenery should be visible.

**2. Separate "Must Have" from "Nice to Have"**

Use acceptance criteria to clarify what's required vs. optional enhancements.

**3. Describe Interactions, Not Just Appearance**

Include:
- Trigger conditions (what causes this to appear/happen)
- Response behavior (what should happen when user interacts)
- State transitions (how it changes over time)

**4. Reference the Main Spec When Applicable**

If your expectation implements something from `agent-rules/main-spec.md`, quote the relevant section:

```markdown
From main-spec.md (lines 166-186):
> "On-Tap Property Preview: Instant preview card appears near the tapped property"
```

**5. Include Technical Hints (Optional)**

If you know how something should be implemented, include hints:

```markdown
## Technical Notes
- Use MapLibre's fill-extrusion layer for 3D buildings
- Building heights from PDOK 3D BAG data
- NativeWind/TailwindCSS for styling
```

**6. Define Clear Success Criteria**

Agents need to know when they're done. Be explicit:

```markdown
## Acceptance Criteria (SUFFICIENT)
1. Preview card appears within 200ms of tapping a marker
2. Address and price are displayed
3. All three action buttons (Like, Comment, Guess) are visible
4. Zero console errors during test execution
```

### Reference Image Best Practices

1. **Crop to relevant area** - Don't include unnecessary UI
2. **Annotate if needed** - Add arrows/labels in complex images
3. **Show different states** - Multiple images for different states (empty, loading, error)
4. **Use real-world examples** - Screenshots from production apps show proven UX patterns

## Directory Structure

```
reference-expectations/
├── expectations-workflow.md                    # This file
├── 0000-swipeable-clustered-nodes/
│   ├── expectation.md
│   └── funda-paged-group-previews.jpeg
├── 0001-map-visuals-close-up/
│   ├── expectation.md                          # What we want
│   └── close-up-map-visuals.jpeg               # Reference from Snap Maps
├── 0004-price-guess-slider-ui/
│   └── expectation.md                          # No image (text-only spec)
└── NNNN-[your-new-expectation]/                # Use next available number
    ├── expectation.md
    └── [reference-images...]

test-results/reference-expectations/            # Auto-generated by tests
├── 0001-map-visuals-close-up/
│   └── 0001-map-visuals-close-up-current.png
└── NNNN-[expectation-name]/
    └── NNNN-[expectation-name]-current.png
```

## Triggering Expectations

Tell the agent to work on expectations using these phrases:

| Command | Action |
|---------|--------|
| "Work on all reference expectations" | Process every folder in `reference-expectations/` |
| "Work on reference expectation 0001-map-visuals-close-up" | Process single expectation |
| "Work on reference expectations 0001 and 0002" | Process multiple expectations (by number or full name) |

New expectations added to the folder are automatically discovered.

## Console Health Requirement

All reference expectations have an implicit requirement: **zero console errors**.

The e2e test that captures screenshots must:
1. Collect browser console logs during execution
2. Fail if any `console.error` is detected (warnings are acceptable)
3. Report console health status to the verification step

This ensures implementations are not just visually correct but also functionally sound.

## Example: Creating a New Expectation

Let's say you want to add a "dark mode toggle" feature.

### 1. Find the next available number

```bash
ls reference-expectations/ | grep "^[0-9]" | tail -1
# Output: 0020-backend-vector-tile-clustering
# Next number is 0021
```

### 2. Create the folder

```bash
mkdir reference-expectations/0021-dark-mode-toggle
```

### 3. Write expectation.md

```markdown
# Dark Mode Toggle - Reference Expectation

## Overview

A toggle switch in the app settings that allows users to switch between
light and dark color themes.

## Visual Requirements

### Toggle Component
- Standard iOS/Android style toggle switch
- Positioned in settings menu under "Appearance"
- Label: "Dark Mode" with sun/moon icon
- Toggle shows current state (on = dark theme active)

### Theme Changes When Enabled
- Background: #1a1a1a (near black)
- Text: #ffffff (white)
- Cards: #2d2d2d (dark gray)
- Accent colors remain the same (primary blue, etc.)

## Interaction Behavior

- Toggle is immediately responsive (no loading state)
- Theme change should animate smoothly (200ms transition)
- Preference persists across app restarts

## Acceptance Criteria (SUFFICIENT)

1. Toggle is visible in settings
2. Tapping toggle changes app theme
3. Dark theme colors are applied correctly to main surfaces
4. Theme persists after page refresh
5. Zero console errors
6. No bugs seen, even if they seem unrelated to the feature

## Acceptance Criteria (NEEDS_WORK)

- Visible bugs, even if they seem unrelated to the original feature
- Toggle not visible or not functional
- Theme doesn't change when toggled
- Colors are incorrect or unreadable
- Console errors during toggle
```

### 4. Add reference image (optional)

Add a screenshot from iOS Settings showing the dark mode toggle, or a mockup from Figma.

### 5. Trigger the agent

> "Work on reference expectation 0021-dark-mode-toggle"

The agent will now iterate until the implementation matches your expectation.

## Tips for LLMs Creating Expectations

1. **Read existing expectations first** - Understand the patterns used in this project
2. **Check main-spec.md** - See if the feature is already specified there
3. **Be concrete** - Agents work better with specific, measurable criteria
4. **Think about testability** - How will the e2e test verify this?
5. **Consider edge cases** - Empty states, error states, loading states
6. **Keep scope focused** - One expectation = one cohesive feature/visual
