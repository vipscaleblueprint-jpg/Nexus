# Nexus Workspace

## Stack
- **Package Manager:** npm (frontend and server)
- **Frontend:** React 19, Next.js 16.3.4 (App Router), Tailwind CSS v4, Zustand, TipTap, yjs.
- **Server:** Node.js (tsx), Express, Prisma ORM, PostgreSQL, Socket.io, BullMQ.

## Architecture
- **Frontend (`/frontend`):** Uses `/src/app` for routing, `/src/components` for UI, `/src/api` for data fetching, `/src/lib` for utils. 
- **Server (`/server`):** Layered pattern with `/src/routes`, `/src/controllers`, `/src/services`, `/src/middleware`, `/src/validation`, `/src/workers`.

## Coding Style Constraints
- **Frontend:** Server Components by default; add `"use client"` only for state/effects (e.g. Zustand, Socket.io). Use `lucide-react` exclusively for icons. Do not use inline styles; rely strictly on Tailwind CSS v4. Re-use existing components (like `ActionMenu`) to ensure OOP principles.
- **Server:** Rely strictly on Prisma schema for types and database operations. Never modify the database schema without human confirmation. Follow layered separation (routes -> controllers -> services).

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
