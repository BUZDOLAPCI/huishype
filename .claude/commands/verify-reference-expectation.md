# Verify Reference Expectation

Visual verification command for comparing app screenshots against reference expectations.

## Usage

```
/verify-reference-expectation <expectation-name>
```

## Arguments

- `expectation-name`: Name of the expectation folder (e.g., `map-visuals-close-up`)

## Process

1. **Load Reference Materials**
   - Read `reference-expectations/{name}/expectation.md`
   - View reference image(s) in `reference-expectations/{name}/`

2. **Load Current Screenshot**
   - Read screenshot from `test-results/reference-expectations/{name}/{name}-current.png`
   - If screenshot doesn't exist, report error and suggest running e2e test first

3. **Visual Comparison**
   Using vision capabilities, compare:
   - Overall visual style/appearance
   - Specific elements mentioned in expectation.md
   - Color schemes and styling
   - Layout and component placement
   - Any functional requirements described

4. **Evaluation Criteria**
   Rate each criterion from expectation.md:
   - MATCHES: Current implementation matches expectation
   - PARTIAL: Some aspects match, others need work
   - MISSING: Expectation not met

5. **Output Verdict**

```
## Verification Report: {name}

### Verdict: SUFFICIENT | NEEDS_WORK

### Comparison Summary
| Criterion | Status | Notes |
|-----------|--------|-------|
| {criterion1} | MATCHES/PARTIAL/MISSING | {details} |
| ... | ... | ... |

### Visual Match Score: X/10

### Feedback (if NEEDS_WORK)
- Specific change 1
- Specific change 2
- ...
```

## Example

```
/verify-reference-expectation map-visuals-close-up
```

This will compare the current map close-up screenshot against the Snap Maps reference to check for:
- 3D building extrusions
- Road visibility
- Greenery/trees
- Color scheme (white, off-white, grey-ish, beige)
- Soft shadows from lighting
