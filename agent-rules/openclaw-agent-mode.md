# Huishype Agent Mode (OpenClaw → Claude Code Orchestrator)

## Goal
OpenClaw is the **orchestrator**. Claude Code (with Agent Teams/subagents) is the **executor**.

- OpenClaw does **not** implement product code itself.
- OpenClaw launches, supervises, and quality-gates Claude Code runs.
- Done means: root-cause fixes, polished UX, and full verification green.

---

## Non-Negotiables

1. **Delegate everything**
   - Lead Claude agent orchestrates.
   - Product-design / architecture / implementation / review / QA are delegated to teammates/subagents.
   - No substantial coding on lead agent.

2. **No workaround policy**
   - No temporary fixes, TODOs, “future work”, soft skips.
   - Fix root causes with optimal architecture.

3. **Scope extension allowed**
   - If adjacent systems block quality, orchestrate work there too.
   - If unrelated defects are discovered, open and run focused teammate tasks.

4. **Spec-first alignment**
   - Always verify against:
     - `agent-rules/main-spec.md`
     - `agent-rules/test-requirements.md`
     - active plan docs (e.g. `PLAN-unified-preview-card.md`, `cluster-improvements.md`)

5. **Quality loop required**
   - Design/review workers find gaps.
   - Dev workers implement.
   - Review workers evaluate against spec/prompt.
   - Analyzer workers validate findings.
   - Repeat until bar is met.

6. **No premature completion**
   - Work is not done until all required tests pass and visual polish is verified.

---

## Required Verification Gate (before any “done”)

## A) Static + unit/integration
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

## B) Web e2e
- `pnpm test:e2e:web`
- Include map + preview-card flows

## C) Native e2e (Maestro)
- Run Maestro flows on emulator for impacted areas
- Especially map interactions, node taps, card swipe, panel transitions

## D) Visual verification
- Capture screenshots for critical states
- Verify with a vision-capable agent/model for:
  - glitches/artifacts/stutter cues
  - map/card layering correctness
  - polish parity vs benchmark expectations (Funda/Pararius/Snap-style quality bar)

## E) Regression scan
- Confirm no side effects in previously stable map/node interactions
- Validate both web + native behaviors for the same feature flow

---

## Map/Card Critical Behavior Contract

For current preview-card/map work, these are treated as release blockers unless explicitly waived:

1. Cards remain **geo-anchored to nodes** (not viewport-clamped away from markers).
2. Cards are map-layer artifacts, not detached UI overlays.
3. Native layering: cards remain behind bottom sheet as intended.
4. Native interaction smoothness must match map baseline (no tacky stutter).
5. Card swiping works bi-directionally (forward/back) where applicable.
6. Web click flow:
   - first node click → preview card
   - side panel opens only on card/action interaction
7. Card swipe gestures should not unintentionally pan map.
8. Any temporary fallback (e.g., nearby API trigger spam) must be disabled or replaced with validated native-first interaction path.

---

## OpenClaw Orchestration Protocol

1. OpenClaw starts Claude task with a **single, bounded sprint objective**.
2. Claude must explicitly spawn teammate structure.
3. OpenClaw monitors logs and only intervenes when:
   - blocked/question
   - failed verification
   - unclear ownership/scope drift
4. On completion, OpenClaw requires a structured report:
   - tasks delegated + outputs
   - files changed
   - tests run + pass/fail
   - visual verification evidence
   - remaining risks (should be none unless explicitly accepted)
5. If any gate fails, OpenClaw starts next corrective sprint immediately.

---

## Completion Template (required in Claude final report)

- **Scope completed**
- **Teammates used and responsibilities**
- **Root-cause summary per issue**
- **Changed files**
- **Verification matrix**
  - lint/typecheck/test
  - playwright suites
  - maestro flows
  - visual checks
- **Spec alignment check** (`main-spec.md`, active plan doc)
- **Residual risk / follow-ups** (must be empty unless human-approved)

---

## Default stance
If uncertain between “ship now” and “iterate once more for polish”, choose iterate.
