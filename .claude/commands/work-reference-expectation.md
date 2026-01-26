# Work on Reference Expectation

Orchestrate the full analyze → implement → verify loop for reference expectations.

## Usage

```
/work-reference-expectation <expectation-name | all>
```

## Arguments

- `expectation-name`: Specific expectation folder name, or `all` to process all expectations

## Workflow

This command triggers the Reference Expectations Workflow defined in CLAUDE.md.

### For Each Expectation:

#### Phase 1: Analysis
Spawn Analyzer subagent:
```
Task: Analyze reference expectation '{name}'

1. Read reference-expectations/{name}/expectation.md
2. View reference image(s) in that folder
3. Explore current app implementation
4. Document gaps between current state and desired state
5. Create actionable list of changes needed

Output: Analysis report with specific implementation tasks
```

#### Phase 2: Implementation
Spawn Fixer subagent:
```
Task: Implement reference expectation '{name}'

Analysis findings: {analysis_from_phase_1}

Requirements:
1. Implement code changes to achieve expectation
2. Create e2e test: apps/app/e2e/visual/reference-{name}.spec.ts
3. Test must navigate to relevant state and screenshot to:
   test-results/reference-expectations/{name}/{name}-current.png
4. Run test to generate screenshot
5. Ensure all existing tests still pass

Output: Implementation summary + screenshot path
```

#### Phase 3: Verification
Spawn Visual Tester subagent:
```
Task: Verify reference expectation '{name}'

Compare using vision:
- Reference: reference-expectations/{name}/ (images)
- Expectation: reference-expectations/{name}/expectation.md
- Current: test-results/reference-expectations/{name}/{name}-current.png

Output:
- VERDICT: SUFFICIENT or NEEDS_WORK
- REASONING: Detailed comparison
- FEEDBACK: If NEEDS_WORK, what specifically to fix
```

#### Phase 4: Loop Decision
- If SUFFICIENT: Mark task complete, continue to next expectation
- If NEEDS_WORK: Return to Phase 1 with feedback, repeat

## Task Tracking

Create task for tracking:
```
TaskCreate:
  subject: "Reference Expectation: {name}"
  description: "Match app to reference-expectations/{name}"
  activeForm: "Working on {name} expectation"
```

Update status through phases.

## Examples

Work on single expectation:
```
/work-reference-expectation map-visuals-close-up
```

Work on all expectations:
```
/work-reference-expectation all
```

Work on multiple (via natural language):
```
User: "Work on reference expectations map-visuals-close-up and swipeable-clustered-nodes"
```
