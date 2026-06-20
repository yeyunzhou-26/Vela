# Vela Review Slices

Date: 2026-06-19
Branch: `feat/vela-ai-operating-desk`

This file proposes review and commit slices for the current Vela Phase 5 worktree. It is a preparation aid only; no files have been staged or committed by this document.

## Slice 1: Mission Runtime And API

Purpose: land mission behavior before UI surfaces consume it.

Files:

- `src/vela/mission-runtime.js`
- `src/api.js`
- `src/test-vela-mission.js`

Review focus:

- Mission state transitions
- Permission modes and policy gates
- Voice intent routing and privacy gates
- Review check blocking and recovery actions
- Persistence and trace events

Validation:

```bash
npm run test:vela-mission
```

## Slice 2: Vela Shell And Chinese UI

Purpose: land the Focused Workbench shell and Chinese-first visible UI.

Files:

- `vela.html`
- `src/ui/vela/app-shell.js`
- `src/ui/vela/command-bar.js`
- `src/ui/vela/intelligence-spine.js`
- `src/ui/vela/locale.js`
- `src/ui/vela/mission-rail.js`
- `src/ui/vela/mission-surface.js`
- `src/ui/vela/mission-switcher.js`
- `src/ui/vela/mission-workspace.js`
- `src/ui/vela/state/mission-store.js`
- `src/ui/vela/styles/vela.css`
- `src/ui/vela/voice-layer.js`

Review focus:

- Right Intelligence Spine is collapsed by default
- Center Mission Workspace has one primary surface
- Vela stays separate from legacy Brain UI
- Chinese visible shell text is complete enough for first use
- Voice layer, guard attention, and review attention remain legible

Validation:

```bash
npm run smoke:vela-shell
npm run smoke:vela-entry
```

## Slice 3: Screenshot And Entry Regression

Purpose: land visual and entry smoke coverage after the UI exists.

Files:

- `scripts/vela-visual-assertions.mjs`
- `scripts/smoke-vela-shell.mjs`
- `scripts/smoke-vela-entry.mjs`

Review focus:

- Screenshot states cover shell and real entry paths
- PNG detail checks catch blank or flat renders
- UI text clipping checks cover compact controls
- English shell chrome and fixture checks catch accidental untranslated UI
- Entry smoke captures persisted mission, artifact, permission, review, and policy states

Validation:

```bash
npm run smoke:vela-shell
npm run smoke:vela-entry
```

## Slice 4: Phase 5 Evals And Packaging Readiness

Purpose: land eval gates and package-scope checks.

Files:

- `package.json`
- `scripts/eval-vela-golden-trace.mjs`
- `scripts/eval-vela-tool-permission.mjs`
- `scripts/eval-vela-voice-latency.mjs`
- `scripts/eval-vela-review-claim.mjs`
- `scripts/eval-vela-product-contract.mjs`
- `scripts/eval-vela-review-slices.mjs`
- `scripts/eval-vela-polish-readiness.mjs`
- `scripts/smoke-vela-packaged.mjs`

Review focus:

- Golden trace, memory, tool permission, voice latency, and review claim coverage
- Product contract checks for `zh-CN`, collapsed Spine, no dashboard chrome, and no Brain UI asset imports
- Review slice coverage for all current Vela dirty files
- Packaged app includes Vela runtime/UI files
- Packaged-like resources root serves Vela HTML, shell assets, and stylesheet through the real API
- Test-only helpers and evals stay excluded from packaged app
- Screenshot manifest and gallery generation remains under `output/playwright/vela/`

Validation:

```bash
npm run smoke:vela-packaged
npm run eval:vela-product-contract
npm run eval:vela-review-slices
npm run eval:vela-polish-readiness
```

## Slice 5: Handoff Documentation

Purpose: land status docs after the executable checks are green.

Files:

- `docs/superpowers/status/2026-06-19-vela-phase-5-handoff.md`
- `docs/superpowers/status/2026-06-19-vela-review-slices.md`
- `docs/superpowers/status/2026-06-20-vela-pr-draft.md`
- `docs/superpowers/status/2026-06-20-vela-validation-log.md`
- `docs/superpowers/status/2026-06-20-vela-visual-signoff.md`
- `docs/superpowers/status/2026-06-20-vela-live-browser-check.md`

Review focus:

- Current phase and hard product rules are accurately summarized
- Screenshot list matches readiness eval
- Remaining limits are explicit
- Commit slicing is practical and matches current diff boundaries
- Latest validation commands are recorded outside chat history
- Manual visual sign-off records first-screen hierarchy, compact layout, and guard/review prominence
- Live in-app browser check records the 4173 preview title, language, Mission Workspace width, and collapsed Spine rail width

Validation:

```bash
npm run eval:vela-polish-readiness
npm run check:vela
```

## Full Gate

Before publishing the branch or opening a PR, run:

```bash
npm run check:vela
npm run smoke:brain-ui
```
