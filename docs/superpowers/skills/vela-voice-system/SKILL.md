---
name: vela-voice-system
description: Use when designing, implementing, testing, or reviewing Vela Voice, including Siri-class voice interaction, ASR/TTS streaming, interruption, spoken repair, voice state machines, screen context, privacy gates, and latency instrumentation.
---

# Vela Voice System

## Voice Goal

Vela Voice is a system-level entry point. It must support natural speech, interruption, repair, personal context, screen context, and app-intent actions.

## Required States

- Idle
- Listening
- Recognizing
- Thinking
- Speaking
- Interrupted
- Needs permission
- Error

## Required Modules

- `VoiceSessionManager`
- `StreamingAsrAdapter`
- `TurnManager`
- `TtsOrchestrator`
- `AudioIo`
- `ContextBridge`
- `AppIntentRegistry`
- `PrivacyGate`

## Interaction Rules

- Spoken and typed commands use the same intent pipeline.
- Barge-in must stop speech quickly and preserve recoverable context.
- Spoken repair such as "not that", "change it", "continue", and "stop" is first-class behavior.
- Screen, file, personal, and external-message context must pass through privacy gates.

## Latency Targets

- Barge-in stop: under 150 ms
- Speech end to intent submit: under 400 ms
- First simple-response token: under 1.5 s after final ASR
- First TTS audio after response segment: under 800 ms
