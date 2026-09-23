# Nexus Workspace Rules & Workflows Index

This file serves as a directory of active rules and workflows for this repository. DO NOT duplicate these rules here; read the source files directly.

- **Global Agent Workflow**: `.agents/rules/core-workflow.mdc`
- **Frontend Rules**: `.agents/rules/frontend-guidelines.mdc`
- **Frontend Design System**: `.agents/rules/design-system.mdc`
- **Server Rules**: `.agents/rules/server-guidelines.mdc`
- **Anti-Hallucination Protocol**: `.agents/rules/anti-hallucination.mdc`
- **Security & Secrets**: `.agents/rules/security.mdc`
- **DB Migration Workflow**: `.agents/skills/db-migration/SKILL.md`
- **Architecture Overview**: `.agents/skills/architecture/SKILL.md`
- **Daily Log Formatting**: `.agents/rules/daily-log-formatting.mdc`

## Real-Time & Websockets
- **True Collaborative Drag-and-Drop:** To achieve instant cross-client drag-and-drop syncing (ClickUp-style), emit lightweight preview websocket events (e.g., `task_move_preview`) continuously during `onDragOver`, rather than waiting for `onDragEnd` API calls.
- **Prisma & Websocket Performance:** When emitting websocket updates from API endpoints (like `moveTask`), never use massive `include` (e.g., `taskInclude`) payloads that cause multi-second DB queries. Emit only scalar fields; the frontend state reducer (`{ ...t, ...updatedTask }`) is designed to preserve existing nested relations (like comments and assignees) automatically.
- **Asynchronous Background Tasks:** Always execute slow background operations (Cache invalidation, Audit Log generation) asynchronously *after* firing the real-time websocket `io.emit`, so they don't block the API response time.
- **Render Diagnostics:** Avoid global render counting loops for debugging. A single state change in the Kanban board correctly re-renders dozens of components (cards + columns), which triggers false positive "infinite loop" warnings.

