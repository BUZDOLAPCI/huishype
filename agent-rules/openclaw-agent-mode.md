# Agent Mode (OpenClaw → Claude Code Plugin)

## Purpose
Use OpenClaw as orchestration/control plane and Claude Code as execution engine.

- OpenClaw coordinates tasks, progress, approvals, and verification gates.
- Claude Code handles implementation via focused subagents/teams.
- Lead orchestration agent should delegate work; avoid doing substantive coding on the lead.

## Core Rules

1. Delegate by focused scope (one bounded objective per worker).
2. Prefer root-cause fixes over temporary patches.
3. Run verification loops until quality bar is met.
4. Track blockers explicitly and resolve before completion.
5. Completion requires passing required tests for impacted scope.

## Verification Gate Template

- lint
- typecheck
- unit/integration tests
- relevant e2e suites
- targeted visual/UX verification when UI behavior changed

## Interface
Use the Claude Code plugin tools/commands as the primary interface for:
- launch
- session listing
- foreground/background control
- respond/follow-up
- resume/fork

## Completion Report
Every sprint should end with:
- scope completed
- delegated workers + outputs
- changed files/modules
- verification matrix (pass/fail + evidence)
- remaining risks/blockers
