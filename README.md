# ⚡ Nexus — Enterprise Project Management & Collaboration Platform

Nexus is a feature-rich, high-performance project management, documentation, and team communication platform inspired by ClickUp. Built with a **Node.js + Express (TypeScript)** backend, **Prisma ORM with PostgreSQL**, **Redis**, **Socket.io**, and **Cloudflare R2 storage**.

---

## 🚀 Key Application Features

### 📁 1. Project Management & Workspace Hierarchy
Nexus provides a deep, multi-tiered organizational structure designed for multi-team enterprise workflows:
- **⭐ Favorites**: Quick-access pinning for any Space, Folder, Subfolder, List, or Doc across the workspace.
- **🌌 Spaces**: High-level organizational boundary for departments, clients, or major business units.
- **📁 Folders & 📂 Subfolders**: Multi-level nested folder system for granular workspace organization.
- **📝 Lists & 📄 Docs**: Flexible entity creation where workspaces can house standard task lists or rich text documents seamlessly.

---

### 📄 2. Smart Docs & Daily Priorities
Doc management integrated directly into your workflow:
- **📅 Date-Organized Docs**: Dedicated documentation subtabs (e.g., *Priorities for Today*) organized chronologically.
- **🤖 Auto-Listing Tasks**: Dynamic rendering of all active tasks and subtasks relevant to the document date.
- **💼 Client Sorting**: Automatic grouping and sorting of tasks by Client Name for fast client management.

---

### 📋 3. Advanced Kanban Board & Workflow Engine
Interactive board views powered by custom workflow rules and role-based access control:
- **➕ Task Creation**: Quick task creation directly inside column views.
- **📊 Collapsible Status Columns & Sub-Columns**: Multi-tier Kanban status columns (e.g., `In-Review` ➔ `In-Checking`).
- **🪢 Drag-and-Drop Interface**: Smooth task re-ordering and status transition using `@dnd-kit`.
- **🔍 Assignee & Team Filtering**: Instantly filter boards by individual assignees or functional teams.
- **⚙️ Status Transition Rule-Sets**:
  - **Subtask Dependency**: Prevent moving tasks to completed status if subtasks are pending.
  - **Checklist Dependency**: Block status change until all checklist items are checked.
  - **Role-Gated Transitions**: Enforce role authorizations for status changes:
    - 🔍 **Auditor**: Only role authorized to sign off on audit verification checkboxes.
    - 👔 **Project Manager (PM)**: Only role authorized to move tasks from `In-Review` to `In-Checking`.
    - 🤝 **CRM**: Only role authorized to set a task to `Closed`.

---

### ✅ 4. Tasks, Subtasks & Rich Collaboration
Granular task execution features:
- **📝 Rich Task Descriptions**: Powered by Tiptap WYSIWYG editor.
- **💬 Threaded Comments**: Real-time discussion thread per task.
- **👥 User & Team Assignments**: Assign tasks to individual team members or entire dynamic teams (**Design**, **Dev**, **Production**, **Marketing**, **Management**).
- **🚨 Priority & Real-Time Pop-up Alerts**: 4 Priority levels (`LOW`, `MEDIUM`, `HIGH`, `URGENT`). Assigning an `URGENT` task triggers an instant Socket.io pop-up alert to the assignee.
- **☑️ Multi-Checklists**: Task checklists with Auditor signature logging (`checkedByUserId`, `checkedAt`).
- **☁️ Cloudflare R2 Uploads**: S3-compatible file storage integration for task attachments and comment files.

---

### 💬 5. Real-Time Communication (Channels & DMs)
Built-in enterprise team messaging system:
- **📢 Channels & Sub-Channels**: Public and private channels organized by topic or team sub-group.
- **✉️ Direct Messaging (DMs)**: 1-on-1 private messaging between users.
- **✏️ Message Editing**: Edit tracking for sent messages (`isEdited`).
- **📎 R2 Attachment Capabilities**: Send media, documents, and code snippets directly in chat.

---

### 👤 6. Advanced User Management & Multi-Role Hierarchy
Flexible user profiles and multi-tier functional role assignments:
- **User Attributes**: Email, Name, Avatar, Daily Sheet URL, Star Rating (`1` to `3` stars), Employment Type (`FULL_TIME`, `PART_TIME`, `INTERN`, `CONTRACTOR`), `isActive` status, `lastLoginAt`.
- **System Role**: `ADMIN`, `MEMBER`.
- **Multi-Role Assignment**: Users hold multiple functional roles simultaneously across 4 slots:
  - **Primary Role**
  - **Secondary Role**
  - **Tertiary Role**
  - **Minor Role**
- **Functional Role Types**: `PM`, `DESIGNER`, `TECH`, `CRM`, `AUDITOR`, `ADMIN`.

---

### 📊 7. Team Table & Roster Management
- **Dynamic Team Roster**: Manage team allocations across **Design Team**, **Dev Team**, **Production Team**, **Marketing Team**, and **Management Team**.
- **Team Workload Breakdown**: View total active tasks assigned per team.

---

## 🏗️ Architecture & Database Model

```
Space
 ├── Folder
 │    └── Subfolder
 │         ├── List ──> TaskColumn (with SubColumns & StatusRules) ──> Task ──> Subtask / Checklist / Attachment / Comment
 │         └── Doc (Date-Organized, Auto-Lists Tasks, Client Sorted)
 ├── List
 └── Doc
```

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Backend** | Node.js, Express, TypeScript, Socket.io, Prisma ORM, BullMQ |
| **Database & Cache** | PostgreSQL, Redis |
| **Object Storage** | Cloudflare R2 (S3 API Compatible) |

---

## 🚀 Getting Started

### 1. Environment Configuration
Backend `.env` file (`/server/.env`):
```env
PORT=5000
DATABASE_URL="postgresql://user:password@localhost:5432/nexus_db?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your_jwt_secret_key"

# Cloudflare R2 / S3 Storage
R2_ACCOUNT_ID="your_account_id"
R2_ACCESS_KEY_ID="your_access_key"
R2_SECRET_ACCESS_KEY="your_secret_key"
R2_BUCKET_NAME="nexus-uploads"
```

### 2. Backend Server Setup
```bash
cd server
npm install
npx prisma db push
npm run dev
```
Express server runs on `http://localhost:5000`.

