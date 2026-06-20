---
name: vela-context-steward
description: Use at the start and end of Vela project sessions, before major edits, after context compaction, or whenever project continuity, dirty-tree discipline, spec reading, branch safety, or handoff matters for the Vela AI Operating Desk.
---

# Vela Context Steward

## Startup Checklist

1. Read `docs/superpowers/specs/2026-06-13-vela-ai-operating-desk-design.md`.
2. Check `git status --short` and protect unrelated user changes.
3. Confirm the active goal and current phase.
4. Prefer live code over stale docs when repo facts matter.
5. Keep Vela work separate from legacy BaiLongma cleanup unless the current phase requires both.

## Core Rules

- Vela is the new product shape; BaiLongma is the legacy capability source.
- Right-side Intelligence Spine defaults collapsed. Treat this as a hard product rule.
- The center Mission Workspace is sacred: one primary work surface at a time.
- Do not add Vela code into the old monolithic Brain UI unless a temporary adapter is explicitly needed.
- If the worktree is dirty, stage and commit only files created or intentionally edited for the current task.

## Handoff Checklist

- Summarize what changed.
- List validations run and failures.
- Mention any dirty files not touched.
- Point the next session to the current phase and the Vela spec.
