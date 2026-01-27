# 0037 - Property Photo Placeholder

## Severity
**High** - Affects perceived quality and takes up ~40% of visible content area

## Problem Statement

The property detail view currently displays a large gray placeholder with a generic image icon and "Property Photo" text when no property image is available. This placeholder:

- Looks unpolished and resembles an error state or broken image
- Takes up approximately 40% of the visible content area without providing value
- Creates a poor first impression of the application
- Wastes valuable screen real estate that could show useful information

## Expected Behavior

Instead of a generic gray placeholder box, the property photo area should display meaningful visual content:

### Primary Options (in order of preference)

1. **Satellite/Aerial Imagery** - Use PDOK aerial imagery service to show a top-down view of the property with a pin overlayed on property, same as preview card is already doing.

### Fallback Option

4. **Well-Designed Placeholder** - If the satellite photo errors or not available for some reason, implement a fallback that uses this placeholder image (reference-expectations/0037-property-photo-placeholder/property-image-placeholder.png)

Don't use it directly from this path, copy it to an appropriate location

## Acceptance Criteria

- [ ] Property detail view never shows the generic gray "Property Photo" placeholder
- [ ] At minimum, the primary visual option (satellite) is implemented
- [ ] The visual content provides actual value/context about the property
- [ ] The implementation gracefully handles loading states (skeleton loader, not empty gray)
- [ ] The implementation gracefully handles error states (styled fallback, not broken image icon)
- [ ] Image area maintains appropriate aspect ratio and doesn't cause layout shifts
- [ ] Performance is acceptable (lazy loading, appropriate image sizes)
- [ ] An overlayed 'pin' exists on top of the property, check 'reference-expectations/0037-property-photo-placeholder/woningstats-tegenbosch-16.png'
- [ ] Zero console errors during rendering
- [ ] Ensure the placeholder image is implemented


## Technical Notes

- PDOK aerial imagery is already implemented for preview cards

## Reference

The current implementation shows a empty gray box - this is what needs to be replaced with meaningful visual content.
