---
title: API Key Management UI
status: planned
priority: critical
linkedFiles:
  - app/components/SettingsModal.vue
  - lib/providers/anthropic.ts
  - lib/providers/openai.ts
  - lib/providers/ollama.ts
  - composables/useAgent.ts
tags:
  - auth
  - settings
  - blocking
createdAt: 2026-03-18T20:50:00.000Z
updatedAt: 2026-03-18T20:50:00.000Z
---

Users have no way to enter API keys for Anthropic or OpenAI in the UI. Agents fail silently when no key is configured.

## Requirements

- Add API key input fields in SettingsModal for each provider (Anthropic, OpenAI)
- Ollama is local and doesn't need a key, but needs a configurable base URL
- Keys must be persisted securely (not plain text in JSON — use Tauri's secure storage or OS keychain)
- Show a clear "API key required" message in the agent window when a provider has no key configured
- Validate keys on save (test call to check if the key works)
- Allow clearing/resetting keys

## Current State

- Providers expect `apiKey` in AgentConfig but there's no UI to set it
- No credential storage mechanism exists
- Keys can only be passed programmatically
