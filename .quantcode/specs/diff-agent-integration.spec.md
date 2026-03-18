---
title: Diff Viewer Agent Integration
status: planned
priority: medium
linkedFiles:
  - app/components/Windows/DiffWindow.vue
  - composables/useAgent.ts
  - lib/mcp/client.ts
  - lib/diff/parser.ts
tags:
  - agent
  - diff
createdAt: 2026-03-18T20:50:00.000Z
updatedAt: 2026-03-18T20:50:00.000Z
---

When an agent writes files, the changes should automatically appear in a Diff Viewer window for review. The accept/reject UI already exists but isn't connected to agent tool execution.

## Requirements

- When an agent calls write_file, capture the before/after content
- Auto-open or update a linked Diff Viewer window showing the agent's changes
- Accept hunk → apply the change to disk
- Reject hunk → revert to original content
- Accept All / Reject All for batch operations
- Link diff windows to their source agent window visually

## Current State

- DiffWindow has accept/reject UI (agent mode) when diffs prop is passed
- Git diff mode works for viewing workspace changes
- No connection between agent tool execution and diff generation
- Agent write_file calls go directly to disk with no diff capture
