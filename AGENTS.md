# Nexus Workspace Rules & Workflows Index

This file serves as a directory of active rules and workflows for this repository. DO NOT duplicate these rules here; read the source files directly.

<<<<<<< Updated upstream
## Architecture
- **Frontend (`/frontend`):** Uses `/src/app` for routing, `/src/components` for UI, `/src/api` for data fetching, `/src/lib` for utils. 
- **Server (`/server`):** Layered pattern with `/src/routes`, `/src/controllers`, `/src/services`, `/src/middleware`, `/src/validation`, `/src/workers`.

## Coding Style Constraints
- **Frontend:** Server Components by default; add `"use client"` only for state/effects (e.g. Zustand, Socket.io). Use `lucide-react` exclusively for icons. Do not use inline styles; rely strictly on Tailwind CSS v4. Re-use existing components (like `ActionMenu`) to ensure OOP principles.
- **Server:** Rely strictly on Prisma schema for types and database operations. Never modify the database schema without human confirmation. Follow layered separation (routes -> controllers -> services).

## Real-Time & Websockets
- **True Collaborative Drag-and-Drop:** To achieve instant cross-client drag-and-drop syncing (ClickUp-style), emit lightweight preview websocket events (e.g., `task_move_preview`) continuously during `onDragOver`, rather than waiting for `onDragEnd` API calls.
- **Prisma & Websocket Performance:** When emitting websocket updates from API endpoints (like `moveTask`), never use massive `include` (e.g., `taskInclude`) payloads that cause multi-second DB queries. Emit only scalar fields; the frontend state reducer (`{ ...t, ...updatedTask }`) is designed to preserve existing nested relations (like comments and assignees) automatically.
- **Asynchronous Background Tasks:** Always execute slow background operations (Cache invalidation, Audit Log generation) asynchronously *after* firing the real-time websocket `io.emit`, so they don't block the API response time.
- **Render Diagnostics:** Avoid global render counting loops for debugging. A single state change in the Kanban board correctly re-renders dozens of components (cards + columns), which triggers false positive "infinite loop" warnings.

## Testing & Build
- **Frontend Dev:** `npm run dev`
- **Frontend Build:** `npm run build`
- **Frontend Lint:** `npm run lint`
- **Server Dev:** `npm run dev` (starts `tsx watch src/server.ts`)
- **Server Build:** `npm run build` (tsc)

## Non-Negotiables
- Do not modify `server/prisma/schema.prisma` without user approval.
- Always run `npm run prisma:migrate` or `npx prisma db push` inside `server` after approved schema changes.
- Do not bypass state management systems or directly manipulate the DOM.
- Avoid modifying `.next/`, `node_modules/`, or `server/dist/` - these are generated.
=======
- **Global Agent Workflow**: `.agents/rules/core-workflow.mdc`
- **Frontend Rules**: `.agents/rules/frontend-guidelines.mdc`
- **Frontend Design System**: `.agents/rules/design-system.mdc`
- **Server Rules**: `.agents/rules/server-guidelines.mdc`
- **Anti-Hallucination Protocol**: `.agents/rules/anti-hallucination.mdc`
- **Security & Secrets**: `.agents/rules/security.mdc`
- **DB Migration Workflow**: `.agents/skills/db-migration/SKILL.md`
- **Architecture Overview**: `.agents/skills/architecture/SKILL.md`
>>>>>>> Stashed changes
