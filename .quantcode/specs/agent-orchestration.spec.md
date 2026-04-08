---
title: Multi-Agent Orchestration
status: open
priority: high
linkedFiles:
  - lib/agents/orchestrator.ts
  - lib/agents/roles.ts
  - composables/useAgent.ts
  - app/components/Windows/AgentWindow.vue
tags:
  - agent
  - core
createdAt: 2026-03-18T20:50:00.000Z
updatedAt: 2026-04-08T19:55:53.504Z
---

The orchestrator and role system exist in code but are not wired into the UI or agent execution flow. All agents currently operate as standalone general-purpose agents with no coordination.

## Requirements

- Wire the existing role system (coder, reviewer, tester, coordinator, verifier) into agent window creation
- Allow selecting an agent role when spawning a new agent window
- Implement the coordinator flow: read specs → break into tasks → delegate to specialist agents
- Show task assignments and progress across agent windows
- Allow agents to hand off work to other agents (e.g., coder finishes → reviewer gets notified)

## Current State

- `orchestrator.ts` has: breakdownSpecs, assignTasks, coordinateWorkflow — all unused
- `roles.ts` has 6 role definitions with detailed system prompts — only "general" is used
- Agent windows always spawn as generic agents
- No inter-agent communication
