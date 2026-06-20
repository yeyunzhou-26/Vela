# Vela Phase 5 Handoff

Date: 2026-06-19
Branch: `feat/vela-ai-operating-desk`
Source spec: `docs/superpowers/specs/2026-06-13-vela-ai-operating-desk-design.md`

## Current Phase

Vela is in Phase 5: polish and evaluation.

The current product shape is the Vela AI Operating Desk with a Focused Workbench:

- Top Command Bar
- Left Mission Rail
- Center Mission Workspace
- Right Intelligence Spine
- Bottom-center Vela Voice Layer

Hard product rules still active:

- The right Intelligence Spine is collapsed by default.
- The center Mission Workspace shows one primary surface at a time.
- Vela remains separate from the legacy Brain UI shell.
- The first screen must not become a dashboard.

## Completed Coverage

`check:vela` is now the main Vela readiness gate. It runs:

- `test:vela-mission`
- `smoke:vela-shell`
- `smoke:vela-entry`
- `smoke:vela-packaged`
- `eval:vela-golden-trace`
- `eval:vela-memory-recall`
- `eval:vela-tool-permission`
- `eval:vela-voice-latency`
- `eval:vela-review-claim`
- `eval:vela-product-contract`
- `eval:vela-review-slices`
- `eval:vela-polish-readiness`

Phase 5 now has automated coverage for:

- Mission state transitions and persistence
- Chinese typed and voice command aliases
- Voice privacy gates and spoken approval or denial
- Tool permission modes: Plan, Assist, Act, Auto
- Memory recall references and trace links
- Golden mission trace ordering
- Reviewer claims and blocking review checks
- Static product contracts for the Vela entry, collapsed Spine, and legacy Brain UI separation
- Review slice coverage for all current Vela worktree changes
- Packaged-app inclusion and exclusion rules, plus packaged-like resource-root serving
- Vela shell screenshot regression states
- Vela entry smoke screenshot regression states
- Focused Workbench geometry, UI text clipping, English shell chrome leaks, and common untranslated fixture text
- Manual visual sign-off for first-screen hierarchy, compact layout, and guard/review prominence

## Screenshot Regression Set

The screenshot set is written under `output/playwright/vela/`:

- `vela-shell-desktop.png` at 1280x840
- `vela-shell-artifacts.png` at 1280x840
- `vela-shell-voice-permission.png` at 1280x840
- `vela-shell-review-blocker.png` at 1280x840
- `vela-shell-policy-blocked.png` at 1280x840
- `vela-shell-compact.png` at 640x760
- `vela-entry-root.png` at 1280x840
- `vela-entry-artifacts.png` at 1280x840
- `vela-entry-permission.png` at 1280x840
- `vela-entry-review-blocker.png` at 1280x840
- `vela-entry-policy-blocked.png` at 1280x840

These screenshots are verified by `scripts/vela-visual-assertions.mjs` and `scripts/eval-vela-polish-readiness.mjs`.

Manual visual review notes are recorded in:

- `docs/superpowers/status/2026-06-20-vela-visual-signoff.md`

Live in-app browser verification is recorded in:

- `docs/superpowers/status/2026-06-20-vela-live-browser-check.md`

## Latest Validation

Last known good validation on 2026-06-20:

```bash
npm run check:vela
npm run smoke:brain-ui
git diff --check
```

All passed.

## Known Limits

- In-app browser DOM inspection succeeded for the 4173 Vela preview on 2026-06-20. Automated browser verification should still rely on Playwright smoke for repeatability.
- The current packaging smoke checks inclusion rules and serves Vela from an isolated packaged-like resources root, but it is not a full built installer launch.
- Screenshot assertions check geometry, text clipping, visual detail, and key states; they are not pixel-perfect baselines.

## Next Useful Work

1. Add a true packaged-app launch smoke after a real platform build target is available.
2. Push the Vela branch and open a draft PR after GitHub credentials are available.
3. Continue refining visual density only where screenshots or manual review show concrete friction.
