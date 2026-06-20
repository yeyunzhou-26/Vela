# Vela PR Draft

## Summary

This PR advances Vela from the initial shell/runtime work into Phase 5 polish and evaluation readiness.

Main outcomes:

- Adds a Chinese-first Vela shell with a Focused Workbench layout.
- Keeps the right Intelligence Spine collapsed by default.
- Preserves the center Mission Workspace as a single primary work surface.
- Extends the mission runtime with permission, voice, memory, review, recovery, and trace coverage.
- Adds screenshot regression coverage for shell and real entry states.
- Adds product-contract, packaging, readiness, and review-slice evals.
- Keeps the legacy Brain UI smoke path passing.

## Review Order

Recommended review slices:

1. Mission Runtime And API
2. Vela Shell And Chinese UI
3. Screenshot And Entry Regression
4. Phase 5 Evals And Packaging Readiness
5. Handoff Documentation

See `docs/superpowers/status/2026-06-19-vela-review-slices.md` for file-level details.

See `docs/superpowers/status/2026-06-20-vela-validation-log.md` for the latest validation record.

See `docs/superpowers/status/2026-06-20-vela-visual-signoff.md` for manual screenshot review notes.

See `docs/superpowers/status/2026-06-20-vela-live-browser-check.md` for the latest in-app browser verification.

## Validation

Latest known good validation:

```bash
npm run check:vela
npm run smoke:brain-ui
git diff --check
```

`check:vela` currently includes:

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

## Screenshot Review

The screenshot review gallery is generated at:

- `output/playwright/vela/index.html`

The manifest is generated at:

- `output/playwright/vela/vela-screenshot-manifest.json`

Manual sign-off notes are recorded at:

- `docs/superpowers/status/2026-06-20-vela-visual-signoff.md`

Live browser verification is recorded at:

- `docs/superpowers/status/2026-06-20-vela-live-browser-check.md`

Covered states:

- Desktop first screen
- Artifact workspace
- Voice permission gate
- Review blocker
- Policy blocked
- Compact layout
- Real entry root
- Real entry artifact workspace
- Real entry permission gate
- Real entry review blocker
- Real entry policy blocked

## Risk Notes

- The change set is large and should be reviewed in slices.
- Screenshot checks are structural and visual-detail checks, not pixel-perfect baselines.
- Manual visual sign-off is based on generated screenshot evidence, not a full built-app design review.
- Screenshot smoke also blocks common untranslated English fixture text in Vela-visible states.
- Packaged smoke verifies file inclusion and exclusion rules and serves Vela from an isolated packaged-like resources root; it is not a full built installer launch.
- In-app browser DOM inspection succeeded against the 4173 Vela preview; Playwright smoke remains the repeatable local UI regression path.
- Generated screenshot files live under `output/playwright/vela/` and are not intended as source files.

## Product Contracts

Hard contracts now covered by evals:

- Vela entry is `zh-CN`.
- Vela shell does not load Brain UI assets.
- Intelligence Spine initializes collapsed.
- Mission Workspace keeps one active work mode.
- Vela UI source does not introduce dashboard chrome.
- Current Vela dirty files are assigned to review slices.
- Common untranslated English fixture text is blocked in Vela screenshot smoke.
- Manual visual sign-off records that the first screen keeps one mission surface, collapsed Spine, and visible guard/review blockers.
- Live browser check records `zh-CN`, the Chinese page title, the active mission heading, and a 72px collapsed Spine rail.
