# Nexus Core Memory

This file serves as the core memory restriction for all agents working on the Nexus project. It contains strict brand identity rules, design locks, and a log of past mistakes/tasks to ensure agents do not repeat errors or overwrite established patterns.

## 1. Brand Identity & Design Hash
**Restriction:** Agents must NOT alter these core design principles without explicit user consent. These act as the "Design Hash" locking down the visual identity.

- **Theme:** Dark Mode Dominant (Vibrant accents on dark backgrounds).
- **CSS Framework:** Tailwind CSS.
- **Color Palette:**
  - Backgrounds: `zinc-900`, `zinc-800`.
  - Text: `zinc-400` (secondary), `zinc-200` / `white` (primary).
  - Accents: `purple-400` (Docs), `blue-400` (Lists/Boards), `emerald-400` (Pages), `amber-400` (Folders).
- **Icons:** `lucide-react` exclusively.
- **Interactions:** Use `group` and `group-hover` strictly on the *direct row elements* (not parent wrappers) to isolate hover actions for nested components. Cursor pointers must be explicit on interactive elements.

## 2. Past Mistakes to Avoid
- **Hover State Bug:** Previously, placing `group` on outer wrappers caused all nested items to show their hover actions simultaneously. **Fix:** Always place `group` directly on the flex row that contains the hoverable actions.
- **Prisma vs DBeaver:** **NEVER** modify database columns manually in DBeaver or SQL. Prisma will desync. **Fix:** Always use `schema.prisma` and `prisma migrate dev`.
- **Component Props:** When refactoring tree items (like adding an `onAddList` prop), ensure all instances of the component in the file are updated to avoid TypeScript errors.
- **Unintended Design Alterations:** Never adjust the alignment, layout, or CSS (like adding `justify-center` or altering flex behavior) of existing elements unless explicitly instructed by the user. Ensure new components or wrappers do not inadvertently disrupt the old design.

## 3. High-Level Tasks Accomplished
- Set up database connection to `vps2.vipscaleph.com` via Prisma.
- Refactored `Sidebar.tsx` to include modular `ActionMenu`, `ListTreeItem`, `FolderTreeItem`, and `DocTreeItem`.
- Successfully implemented isolated hover states for nested UI elements in the sidebar.
- Created `architecture.md` and `agentic_rules.md` to govern future agent interactions.

## 4. API Testing Restrictions
- **Development Phase**: The frontend `.env.local` API URL (`NEXT_PUBLIC_API_URL`) must point to `http://localhost:5000` when making backend changes (e.g., adding CRUD routes). The local backend server (`npm run dev` in `server/`) must be running simultaneously to test the new functionality locally.
- **Production Phase**: When pointing to `https://nexus.server.vipscaleph.com`, ensure the local backend changes have actually been deployed. Otherwise, 404 errors will occur.
