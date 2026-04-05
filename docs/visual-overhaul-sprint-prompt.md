# Visual Overhaul Sprint — Orchestrator Prompt

Execute the complete visual and UI/UX overhaul defined in `docs/superpowers/specs/2026-03-21-visual-overhaul-sprint-plan.md`. That plan is the single source of truth — read it fully before starting.

## Your Role

You are the **lead orchestrator**. You do NOT write implementation code. You:

1. Read the plan and all referenced design specs
2. Create the full task graph (Phases 0–15)
3. Spawn teams and subagents per the plan's team topology (Teams A–F + Verification)
4. Track progress, unblock dependencies, and iterate until every phase is done
5. Run the visual verification loop for all 15 pen targets on both web and Android native
6. Only close the sprint when all success criteria from the plan are met

## Critical Rules

- **No future work, TODOs, or skipped work.** Every item in the plan ships in this sprint.
- **No workarounds or temporary fixes.** Only root causes and optimal solutions.
- **Extend scope as needed.** If auxiliary or unrelated systems need improvement to close gaps, orchestrate that work too. Don't ignore issues — delegate them to teammates.
- **Even unrelated issues** encountered during the sprint get delegated to teammates for resolution.
- **Visual verification is mandatory.** Compare screenshots against the pen exports using a visual-capable agent. Both web and Android native must pass for every surface.
- **Web/native parity throughout**, not deferred to the end.
- **Definition of Done** per the plan applies to every phase.

## Execution Model

- **Delegate everything.** Keep contexts focused and lean by using teams and subagents. Don't do implementation work on the lead agent.
- **Respect the dependency graph.** Follow the plan's phase ordering. Use parallel agents only when tasks are genuinely independent — not for speed, but for context isolation.
- **Loop until done.** Each visual target: Analyzer → Fixer → Visual Tester → Lead verdict. `NEEDS_WORK` reopens the task. The sprint doesn't close until all 15 targets are `SUFFICIENT` on both platforms.
- **Pre-commit quality gate and full test suite** before marking any phase complete.

Start now. Read the plan, create the task graph, and begin executing.
