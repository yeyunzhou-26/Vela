# Vela Open Capability Map

Date: 2026-06-21
Status: Approved by user direction, first implementation slice in progress

## Purpose

Vela should become an all-purpose AI assistant by absorbing proven open-source capability patterns, not by rebuilding every tool from scratch.

The product rule is unchanged: the first screen remains a calm chat-first Mission Workspace, and the right Intelligence Spine stays collapsed by default. Open-source capability detail lives behind the mission runtime and the Spine, not in the first screen.

## Product Principle

When the user says anything, Vela should:

1. Understand the intent as a mission.
2. Match the mission to one or more capabilities.
3. Plan with the right agent role.
4. Execute through a guarded tool or adapter.
5. Verify the result.
6. Ask for final confirmation before external or risky effects.
7. Report the outcome naturally.

## Open-Source Intake Strategy

Every GitHub project or public capability source goes through the same intake path:

1. Discover: identify a mature project, reference implementation, or proven pattern.
2. Triage: check license, maintenance, security surface, runtime fit, and whether the idea is reusable.
3. Adapt: wrap it as a Vela capability adapter instead of copying its product shape.
4. Guard: declare risk classes, required permissions, and confirmation rules.
5. Trace: link each use to mission id, plan step, tool call, permission decision, and result.
6. Evaluate: add a focused smoke or eval before the capability becomes trusted.

Permissive projects such as MIT, Apache-2.0, BSD, or similar can be candidates for direct reuse after review. Copyleft, unknown, or unclear-license projects should be treated as learning references unless the license review explicitly approves reuse.

## Capability Record

Each capability is registered as structured metadata:

- `id`: stable Vela capability id, such as `browser.web-agent`.
- `category`: desktop, browser, files, code, memory, messaging, voice, agent, or tool.
- `label`: user-facing Chinese name.
- `summary`: what this capability helps Vela do.
- `triggers`: intent phrases and keywords used by the first local router.
- `agentRole`: Planner, Builder, Researcher, Reviewer, or Operator.
- `riskClasses`: Vela guard risks such as Read, Write, Execute, Network, Screen, Credential, External message, or Destructive.
- `permissionBoundary`: plain-language rule for when the user must confirm.
- `openSourceRefs`: projects, protocols, or reference implementations that inspired the capability.
- `licensePolicy`: direct-eligible, adapter-only, learn-only, or internal.
- `integrationStatus`: planned, adapter-ready, eval-required, or trusted.
- `evaluation`: the smoke or eval that proves the capability works.

## Seed Capability Map

The first registry should seed these capability families:

- Browser agent: learn from Browser Use and Stagehand patterns for browser control, structured extraction, recovery loops, and repeatable actions.
- MCP tool bridge: learn from MCP reference servers for files, git, memory, fetch, time, and secure tool boundaries.
- Agent orchestration: learn from AutoGen and Microsoft Agent Framework style role/workbench patterns, while keeping Vela's own mission model.
- Desktop and app control: local-first Operator capability for apps, windows, and screen context, gated by Screen and Execute permissions.
- Files and documents: file read/write, document creation, and artifact production, gated by Read and Write permissions.
- Messaging: message/email/social-send flows, always gated by External message confirmation before sending.
- Memory: persistent user/project/mission memory with provenance.
- Voice: system-level Vela Voice that routes into the same mission and capability pipeline.

## Runtime Integration

The first implementation slice should not execute external open-source tools yet. It should add a local registry and attach capability matches to every newly started mission.

When a mission starts, Vela records:

- capability references on the mission;
- a `capability.matched` trace event;
- the agent role most likely to handle the next step;
- risk classes that inform Guard later;
- source provenance that can be inspected in the Intelligence Spine.

This gives Vela a real foundation for future GitHub-derived adapters without exposing complexity on the first screen.

## UI Integration

The Mission Workspace stays simple. It should not show a large capability table.

The collapsed Intelligence Spine may show capability evidence inside Tools:

- matched capability count;
- latest matched capability;
- source strategy;
- risk classes;
- permission boundary.

The Spine must remain collapsed by default.

## Validation

Minimum checks for this slice:

- Unit/runtime tests cover capability matching and mission persistence.
- Product contract still passes: chat-first center, collapsed Spine, no dashboard chrome.
- Full `npm run check:vela` remains green before commit.

## Next Slices

After the registry lands:

1. Add a capability adapter interface.
2. Implement browser automation as the first real adapter.
3. Add desktop/app-control adapter behind Screen and Execute guards.
4. Add external message adapter with final send confirmation.
5. Add capability-specific evals for success, failure, and recovery.
