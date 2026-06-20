# Vela Live Browser Check

Date: 2026-06-20
Branch: `main`
Target: `http://127.0.0.1:4173/vela.html`

## Result

The in-app browser check succeeded against the live Vela preview.

Observed browser state:

- URL: `http://127.0.0.1:4173/vela.html`
- Title: `Vela · AI 操作台`
- Document language: `zh-CN`
- Current mission heading: `开始一项 Vela 任务`
- Viewport: `650x855`
- Mission Workspace width: `522px`
- Intelligence Spine visual rail width: `64px`
- Vela Voice layer width: `498px`

## Product Contract Check

- Pass: live DOM inspection is available for the 4173 preview.
- Pass: the right Intelligence Spine remains visually collapsed as a narrow rail.
- Pass: the Mission Workspace remains the dominant center surface.
- Pass: Vela Voice remains bottom-centered and does not cover the mission canvas.
- Pass: the live page uses Chinese-first shell text.
- Pass: the default mission is a clean user-start state, not a Vela Shell demo fixture.

## Note

The accessibility tree includes the Intelligence Spine panel content for inspection, but the visual rail remains collapsed in the captured live screenshot. Automated Playwright smoke remains the primary regression gate; the in-app browser check is a live manual confirmation.
