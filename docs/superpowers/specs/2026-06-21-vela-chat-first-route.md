# Vela Chat-First Route

Date: 2026-06-21
Status: User-directed route change

## User Direction

Vela should feel like an all-purpose AI assistant that helps the user get things done while chatting naturally.

The first screen should be a beautiful, calm chat interface with settings nearby. It should not look like an audit desk, a file review board, or a data-heavy task dashboard.

The mission model, plans, tools, permissions, traces, artifacts, and review chain still matter, but they should run backstage. The user should see outcomes, lightweight progress, and natural confirmations only when needed.

Example target flow:

1. User: "帮打开微信，给我老婆回个信息。"
2. Vela: "好的，我去看一下。"
3. Vela inspects the relevant app/context in the background.
4. Vela drafts the reply and asks: "我准备这样回，可以吗？"
5. User says yes.
6. Vela sends it and reports the result.

## Product Pivot

The visible product moves from "Mission Workspace first" to "Chat-first assistant shell, mission-backed runtime."

This does not delete the AI Operating Desk foundation. It changes what is visible by default:

- Chat is the front door.
- Mission runtime is the hidden operating system.
- Intelligence Spine remains collapsed by default.
- Process, audit, artifacts, and review are available behind "过程" or the Spine.
- Permission prompts should be plain-language confirmations, not workflow paperwork.
- External effects such as sending messages still require final confirmation.

## Open-Source Lessons To Absorb

- OpenHands: long-running agents need a control center, backend choice, local or remote execution, and integrations.
- Browser Use: task automation should start from a plain-language request and keep browser/app sessions persistent.
- Bytebot: serious personal assistants need a real desktop or desktop-like environment, not only APIs.
- Open Interpreter: local execution needs sandboxing, skills, permissions, hooks, and a simple conversational entry point.

## First Implementation Slice

1. Keep the existing Vela runtime and trust machinery.
2. Replace the default center canvas with a chat-first assistant surface.
3. Move plan/artifact details into a smaller process layer.
4. Keep the right Intelligence Spine visually collapsed.
5. Add a deterministic prototype path for external message intents such as WeChat replies.
6. Update Vela product checks so chat-first is a first-screen contract.

## Current Hard Rules

- The user sees results first.
- Vela should speak naturally.
- Final external actions require user confirmation.
- Audit and review stay inspectable, not dominant.
- Do not crowd the first screen.
