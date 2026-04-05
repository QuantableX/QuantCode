---
title: Tool Approval Flow
status: planned
priority: high
linkedFiles:
  - composables/useAgent.ts
  - app/components/Windows/AgentWindow.vue
  - lib/mcp/client.ts
tags:
  - agent
  - security
createdAt: 2026-03-18T20:50:00.000Z
updatedAt: 2026-04-05T17:14:01.341Z
---

When agents request tool execution (file writes, commands, git commits), users need to see what's being done and approve/deny it. The approval handler exists in useAgent but no visible UI dialog is wired up.

## Requirements

- Show a modal/inline dialog when an agent requests a tool call
- Display: tool name, arguments (formatted), and what it will do
- Buttons: Approve, Deny, Always Allow (for this session)
- For destructive tools (write_file, execute_command, git_commit): always require approval
- For read-only tools (read_file, list_directory, git_status): auto-approve or offer a toggle
- Show tool execution result after approval (success/error)

## Current State

- `useAgent.ts` has `setApprovalHandler()` with pending/approved/denied flow
- Tool calls have statuses: pending → approved/denied → completed/error
- No UI component renders the approval dialog — tools likely auto-execute
