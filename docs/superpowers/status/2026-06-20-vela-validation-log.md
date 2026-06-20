# Vela Validation Log

Date: 2026-06-20
Branch: `feat/vela-ai-operating-desk`
Source spec: `docs/superpowers/specs/2026-06-13-vela-ai-operating-desk-design.md`

## Purpose

This file records the latest Phase 5 validation set for the current Vela worktree. It is intended to make handoff and PR review less dependent on chat history.

## Latest Verified Gate

Latest verified locally on 2026-06-20:

```bash
npm run check:vela
npm run smoke:brain-ui
git diff --check
```

All passed.

## Included Vela Gate

`npm run check:vela` currently runs:

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

## Product Contracts Covered

- Vela entry declares `zh-CN`.
- Vela shell stays separate from legacy Brain UI assets.
- The right Intelligence Spine initializes collapsed.
- The center Mission Workspace keeps one active workspace mode.
- The first screen does not become dashboard chrome.
- Current Vela dirty files are assigned to review slices.
- Visual smoke blocks common untranslated English fixture text in Vela screenshots.
- Manual visual sign-off records first-screen hierarchy, compact layout, and guard/review prominence.
- Live in-app browser check records `zh-CN`, the Chinese page title, Mission Workspace width, and 72px collapsed Spine rail.

## Screenshot Evidence

Screenshot evidence is generated under `output/playwright/vela/`:

- `index.html`
- `vela-screenshot-manifest.json`
- 11 PNG screenshots covering shell and real entry states

These generated files are review evidence, not source files.

Manual screenshot review is recorded in:

- `docs/superpowers/status/2026-06-20-vela-visual-signoff.md`

Live in-app browser verification is recorded in:

- `docs/superpowers/status/2026-06-20-vela-live-browser-check.md`

## Known Limits

- Screenshot assertions are structural and visual-detail checks, not pixel-perfect baselines.
- Manual visual sign-off is based on generated screenshot evidence, not a full built-app design review.
- Packaging smoke verifies app file inclusion and exclusion rules plus packaged-like Vela resource serving, not a full installer launch.
- In-app browser DOM inspection succeeded for the 4173 preview, but Playwright remains the repeatable local UI regression path.
