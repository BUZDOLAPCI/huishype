# E2E Test Layer Names Mismatch Fix

## Severity: HIGH (Blocking Tests)

## Problem Statement

E2E tests are failing because they query for MapLibre map layers using incorrect layer names that do not exist in the actual style configuration.

### Current Incorrect Layer Names in Tests
- `ghost-points`
- `active-points`
- `clusters`

### Actual Layer Names in MapLibre Style
- `property-clusters`
- `cluster-count`
- `single-active-points`

## Affected Files

The following E2E test files are failing due to this mismatch:

1. `apps/app/e2e/visual/reference-ghost-vs-active-nodes.spec.ts`
2. `apps/app/e2e/visual/reference-map-view-property-markers.spec.ts`
3. `apps/app/e2e/visual/reference-property-bottom-sheet-details.spec.ts`
4. `apps/app/e2e/visual/reference-reactions-like-system.spec.ts`

## Expected Behavior

E2E tests should use the correct layer names that match the actual MapLibre style configuration. All layer queries in test files must reference layers that actually exist in the map style.

## Acceptance Criteria

1. All E2E tests use the correct layer names matching the MapLibre style configuration
2. Layer name references updated:
   - `ghost-points` → appropriate actual layer name (verify in style config)
   - `active-points` → `single-active-points`
   - `clusters` → `property-clusters`
3. All affected E2E tests pass after the fix
4. No console errors related to missing layers during test execution
5. Tests correctly wait for and interact with the renamed layers
6. Consider creating a shared constants file for layer names to prevent future mismatches

## Implementation Notes

- Review the MapLibre style configuration to confirm all actual layer names
- Update all `page.evaluate()` calls that query map layers
- Update any `waitForFunction()` calls that check for layer existence
- Ensure layer visibility checks use correct names
- Run all affected tests to verify the fix
