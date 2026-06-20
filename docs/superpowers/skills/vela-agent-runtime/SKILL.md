---
name: vela-agent-runtime
description: Use when implementing or reviewing Vela mission runtime, agent roles, subagents, tool routing, permission and sandbox policy, memory/context injection, reviewer flow, traces, evals, and mission lifecycle behavior.
---

# Vela Agent Runtime

## Runtime Goal

Vela should execute missions with controlled autonomy: plan, act, verify, review, and recover.

## Initial Agent Roles

- Planner
- Builder
- Researcher
- Reviewer
- Operator

Roles are execution boundaries, not decorative labels.

## Permission Modes

- Plan: read-only analysis
- Assist: low-risk action with approval for edits and external effects
- Act: scoped edits and commands under guard policy
- Auto: trusted recurring low-risk tasks only

## Trace Requirements

Every meaningful action should be connected to:

- Mission id
- Plan step
- Tool call
- Permission decision
- Memory/context reference
- Result
- Review outcome

## Review Rule

Nontrivial missions require a reviewer outcome before being marked complete.

## Evaluation Surfaces

- Mission state transitions
- Tool policy decisions
- Memory injection quality
- Voice intent routing
- Review claim accuracy
- Packaged app smoke
