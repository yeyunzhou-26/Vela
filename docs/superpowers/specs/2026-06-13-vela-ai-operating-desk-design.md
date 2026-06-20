# Vela AI Operating Desk Design

Date: 2026-06-13
Status: Approved direction, ready for implementation planning

## Fixed Decisions

- Product name: Vela
- Product category: AI Operating Desk
- First screen: Mission Workspace
- Primary layout: Focused Workbench
- Right-side rule: the right panel is collapsed by default as an Intelligence Spine
- Voice goal: Vela Voice must feel like a system-level Siri-class entry point, not a microphone button
- Migration rule: BaiLongma is treated as a capability source, not as the product shape

## Product Thesis

Vela is a personal AI work operating desk. It should combine the controlled execution discipline of Codex and Claude Code with the natural entry point of modern Siri-style voice interaction.

Vela is not a chat app. Chat is only one input mode. The product centers on missions: persistent units of work with goals, plans, execution state, artifacts, permissions, memory, and review.

## Top-Level Benchmarks

- Codex-class execution: sandboxing, task traces, memory, subagents, controlled autonomy
- Claude Code-class workflow: plan/read mode, explicit permission modes, edit/execute/review loops
- Siri-class voice: low-latency speech, interruption, repair, personal context, screen context, and cross-app actions

Official benchmark references:

- https://developers.openai.com/codex/concepts/sandboxing
- https://developers.openai.com/codex/concepts/subagents
- https://developers.openai.com/codex/memories
- https://code.claude.com/docs/en/overview
- https://code.claude.com/docs/en/permission-modes
- https://www.apple.com/apple-intelligence/

## Experience Principles

1. The center is sacred.
   The user should understand the current mission within two seconds. Do not fill the center with logs, graphs, tool cards, or diagnostic panels.

2. Details are available, not exposed.
   Context, memory, tools, permissions, and review live behind the collapsed Intelligence Spine. They expand only when requested or when action is required.

3. Voice is a system layer.
   Vela Voice can listen, interrupt, repair, continue, request permission, and act across the workspace. It should not be implemented as a decorative mic widget.

4. Autonomy must be legible.
   Every meaningful AI action should be traceable to a mission, plan step, tool call, permission decision, and review outcome.

5. The old product does not dictate the new shape.
   Existing BaiLongma code, voice providers, memory modules, review modules, and media tools are assets to migrate into Vela, not layout constraints.

## First-Screen Layout

```text
+--------------------------------------------------------------+
| Top Command Bar                                               |
+--------------+---------------------------------------+-------+
| Mission Rail | Mission Workspace                     | Spine |
|              |                                       | Ctx   |
| Today        | Current Mission                       | Mem   |
| Missions     | Main Work Canvas                      | Tool  |
| Agents       | Next Step / Input / Voice             | Guard |
| Memory       |                                       | Rev   |
| Apps         |                                       |       |
+--------------+---------------------------------------+-------+
```

### Top Command Bar

Purpose: global orientation and command.

Required elements:

- Vela brand mark and name
- Current mission title
- Global command/search input
- Model status
- Permission mode status
- Settings entry

Rules:

- Keep the bar compact.
- Do not turn it into a dashboard.
- Use it to orient, search, command, and show risk state.

### Mission Rail

Purpose: persistent navigation.

Required entries:

- Today
- Missions
- Agents
- Memory
- Apps

Rules:

- Narrow by default.
- Icon plus short label is allowed.
- It should feel like a native OS rail, not a web sidebar.
- It must not contain rich cards or long text.

### Mission Workspace

Purpose: the main work surface.

Default content:

- Current mission header
- One large active work canvas
- One small next-step strip
- Input affordance only when needed

Rules:

- The center shows one primary thing at a time.
- Chat is not the default mental model.
- Plans, files, browser views, generated artifacts, and reports are workspace modes.
- Logs and trace details do not live in the center by default.

### Intelligence Spine

Purpose: collapsed right-side intelligence and trust layer.

Default entries:

- Context
- Memory
- Tools
- Guard
- Review

Rules:

- Collapsed by default. This is fixed.
- Show icons, labels only when space allows, and small status dots.
- Expand only on click, hover intent, permission requests, tool failures, or review warnings.
- Expansion slides from the right and must preserve the main mission workspace.
- Do not show a full right panel on first load.

### Vela Voice Layer

Purpose: system-level spoken control.

Default placement:

- Bottom center, close to the mission input area

Required states:

- Idle
- Listening
- Recognizing
- Thinking
- Speaking
- Interrupted
- Needs permission
- Error

Rules:

- It must be immediately available.
- It must support natural interruption.
- It must support spoken repair: "not that", "change it to", "continue", "stop", "send it".
- It must share the same intent pipeline as typed commands.
- It must not fork into a separate voice-only behavior path.

## Core Product Systems

### Mission System

Each mission contains:

- Goal
- Current state
- Plan
- Steps
- Inputs
- Artifacts
- Tool calls
- Permissions
- Memory references
- Review results
- Recovery actions

Mission states:

- Draft
- Planned
- Running
- Waiting for user
- Waiting for permission
- Blocked
- Reviewing
- Complete
- Failed

### Agent Runtime

Initial agent roles:

- Planner: reads context and proposes mission plan
- Builder: performs scoped implementation or production work
- Researcher: gathers supporting context
- Reviewer: checks claims, failures, and missing verification
- Operator: handles desktop, browser, and app-level actions

Rules:

- Agent roles are execution boundaries, not marketing labels.
- Subagents must have isolated traces.
- Only approved artifacts and changes merge into the active mission.

### Permission And Guard System

Permission modes:

- Plan: read-only analysis
- Assist: low-risk actions allowed, edits and external effects require approval
- Act: scoped edits and commands allowed under guard policy
- Auto: only explicitly trusted recurring tasks

Risk classes:

- Read
- Write
- Execute
- Network
- Credential
- Screen
- External message
- Destructive

Rules:

- Dangerous operations are never hidden.
- High-risk tool use must surface in the main workflow.
- Permissions must be understandable in plain language.

### Memory And Context OS

Memory types:

- User memory
- Project memory
- Mission memory
- Tool memory
- Voice context
- Screen context
- Review memory

Rules:

- Memory must show provenance.
- Users can inspect, disable, edit, or delete memories.
- Memory injection must be traceable in mission review.

## Siri-Class Voice Requirements

Vela Voice must be designed as a system entry point.

Required capabilities:

- Push-to-talk and always-available voice modes
- Streaming ASR partials and finals
- Interruptible TTS
- Barge-in with fast stop
- Spoken repair and continuation
- Personal context lookup
- Screen/workspace context awareness
- App-intent style action routing
- Permission prompts for sensitive context and actions

Latency targets:

- Barge-in stop: under 150 ms
- Speech end to intent submit: under 400 ms
- First simple-response token: under 1.5 s after final ASR
- First TTS audio after response segment: under 800 ms

Voice modules:

- `VoiceSessionManager`
- `StreamingAsrAdapter`
- `TurnManager`
- `TtsOrchestrator`
- `AudioIo`
- `ContextBridge`
- `AppIntentRegistry`
- `PrivacyGate`

## Visual Direction

Direction: Calm Command Futurism.

Rules:

- Premium native desktop feel
- Near-black graphite base, not pure black
- Cool white text
- Restrained cyan and amber accents
- Very limited purple
- No card-heavy dashboard
- No nested cards
- No decorative blobs
- No oversized gradient hero treatment
- Stable dimensions for rails, spine, command bar, voice layer, and mission canvas

The visual hierarchy should say:

1. The current mission matters most.
2. Navigation is always available but quiet.
3. Intelligence is trustworthy and inspectable.
4. Voice is always there, but never in the way.

## Migration Strategy

Create a new Vela shell instead of reshaping the old Brain UI directly.

Recommended target structure:

```text
src/ui/vela/
  app-shell.js
  command-bar.js
  mission-rail.js
  mission-workspace.js
  intelligence-spine.js
  voice-layer.js
  state/
  styles/
  adapters/
```

Legacy assets to migrate:

- Voice core and TTS/ASR provider support
- Memory injector and recall audit concepts
- Tool router and capability executor
- Reviewer module
- Media, document, and browser surfaces
- Turn trace and runtime message protocol

Rules:

- Keep legacy Brain UI as fallback while Vela shell stabilizes.
- Do not put the new product inside the old `app.js`.
- Define adapters between Vela UI and existing backend modules.
- New UI state should not depend on global `window.bailongma*` contracts long term.

## Implementation Phases

### Phase 0: Stabilize The Base

Goal: prevent the new product from inheriting runtime and security instability.

Work:

- Untrack real local config and ignore secret-bearing config files
- Add safe example config
- Align SQLite scripts with Electron runtime
- Fix smoke tests that pass while logging runtime failures
- Add explicit exits to one-shot Electron smoke scripts
- Stabilize Brain UI smoke or isolate it as legacy smoke

Exit criteria:

- Core tests are green without misleading ABI errors
- Secret-bearing config is not tracked
- New Vela work can start without dirtying unrelated legacy files

### Phase 1: Vela Shell

Goal: create the new first screen.

Work:

- Add `src/ui/vela/`
- Implement Top Command Bar
- Implement Mission Rail
- Implement Mission Workspace
- Implement collapsed Intelligence Spine
- Implement bottom Vela Voice Layer shell
- Route app entry to Vela behind a feature flag

Exit criteria:

- Vela launches as a real screen
- Right side is collapsed by default
- The center is calm and mission-first
- Legacy Brain UI remains available

### Phase 2: Mission Runtime

Goal: make missions the main unit of work.

Work:

- Define mission model
- Add mission states
- Connect chat, plan, artifacts, tools, and review to mission state
- Show current mission in the workspace
- Add basic mission persistence

Exit criteria:

- A task can be started, planned, executed, reviewed, and resumed as a mission
- The UI no longer treats chat as the main product object

### Phase 3: Vela Voice

Goal: build Siri-class voice foundation.

Work:

- Introduce voice state machine
- Unify typed and spoken intents
- Add interruption and spoken repair flows
- Move TTS orchestration out of the monolithic app file
- Add context bridge for current mission and selected workspace content
- Add voice latency instrumentation

Exit criteria:

- Voice can start, stop, interrupt, continue, and repair a mission command
- Voice state is visible in the system layer
- Sensitive context use is permissioned

### Phase 4: Guard, Context, And Review

Goal: make autonomy trustworthy.

Work:

- Add permission modes
- Add Guard UI in Intelligence Spine
- Connect tool calls to mission trace
- Connect memory provenance to Context and Memory panels
- Require review result for nontrivial mission completion

Exit criteria:

- User can inspect why Vela acted
- Tool and memory use is visible
- High-risk actions are not hidden

### Phase 5: Polish And Evaluation

Goal: raise product quality to top-tier.

Work:

- Add screenshot regression checks
- Add voice latency checks
- Add tool permission evals
- Add memory recall evals
- Add mission golden traces
- Add packaged-app smoke
- Refine visual density and responsiveness

Exit criteria:

- Vela feels calm on first load
- The main workspace never looks confusing by default
- Voice and mission flows are test-covered

## Validation Plan

Required checks:

- Unit tests for mission state transitions
- Tool permission policy tests
- Voice state machine tests
- Fake ASR/TTS integration tests
- Playwright screenshot checks for Vela desktop and smaller window sizes
- Smoke test for opening Vela shell
- Smoke test for starting and resuming a mission

Manual review checklist:

- Can a new user tell what the current mission is?
- Is the right side collapsed by default?
- Does the center show only one main work surface?
- Can the user inspect context, memory, tools, guard, and review when needed?
- Does Vela Voice feel like a system layer?
- Are high-risk actions impossible to miss?

## Project Skills To Use

The Vela work should use these project-specific skills:

- `vela-context-steward`: session startup, dirty tree discipline, Vela spec continuity
- `vela-product-systems`: product architecture, mission system, guard model, phased decisions
- `vela-application-ui`: Focused Workbench UI, visual hierarchy, collapsed Intelligence Spine
- `vela-voice-system`: Siri-class voice architecture and validation
- `vela-agent-runtime`: mission runtime, agents, permissions, memory, review, traces

## Next Session Kickoff

Recommended first message for the new session:

```text
我们开始做 Vela。先使用 vela-context-steward 读取 Vela spec，然后按 Phase 0 和 Phase 1 开干：先修运行地基，再做 Vela Shell。右侧 Intelligence Spine 默认折叠是硬规则。
```

The first implementation session should not start by editing visual details. It should first confirm the working tree, runtime scripts, config safety, and the new Vela shell target path.
