---
title: Error Handling & Resilience
status: planned
priority: medium
linkedFiles:
  - composables/useAgent.ts
  - lib/providers/anthropic.ts
  - lib/providers/openai.ts
tags:
  - reliability
  - agent
createdAt: 2026-03-18T20:50:00.000Z
updatedAt: 2026-03-18T20:50:00.000Z
---

Error handling is basic throughout the app. API failures show generic messages, there's no retry logic, and some errors fail silently.

## Requirements

- Provider API errors: show clear message (rate limit, auth failure, network) with retry button
- Tauri command failures: surface to user with context instead of swallowing in catch blocks
- Agent streaming errors: recover gracefully, allow resending the last message
- Network connectivity: detect offline state and pause/queue operations
- Tool execution errors: show the error in the agent chat with the failed tool call context

## Current State

- Most catch blocks log to console or set a generic error string
- No retry logic anywhere
- Provider errors surface as raw error messages
- Some Tauri invoke failures are silently caught (e.g., spec status updates, browser data)
