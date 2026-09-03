# Nexus — Enterprise Full-Stack Application Setup

Nexus is initialized with a **Next.js 14+** frontend and a **Node.js (Express)** backend with all required dependencies installed and ready for development.

---

## 🛠️ Installed Packages & Setup

### Frontend (`/frontend`)
- **Next.js 14+ (App Router)** & **React 18**
- **TypeScript**
- **Tailwind CSS** + PostCSS + Autoprefixer
- **Zustand** (State Management)
- **TanStack React Query** (Data Fetching & Caching)
- **dnd-kit** (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`)
- **Tiptap Editor** (`@tiptap/react`, `@tiptap/starter-kit`)
- **Socket.io-client**
- **Lucide Icons**, **clsx**, **tailwind-merge**

### Backend (`/server`)
- **Node.js + Express** with **TypeScript**
- **Prisma ORM** (`@prisma/client`, `prisma`)
- **PostgreSQL** schema configuration (`prisma/schema.prisma`)
- **Redis Client** (`ioredis`)
- **Socket.io** Server
- **BullMQ** (Background job processing)
- **JWT** (`jsonwebtoken`) & **bcryptjs** (Password hashing)

---

## 🚀 Getting Started

### 1. Backend Server
```bash
cd server
npm run dev
```
Express server runs on `http://localhost:5000`.

### 2. Frontend Web App
```bash
cd frontend
npm run dev
```
Next.js app runs on `http://localhost:3000`.

---

## 📁 Repository Structure

```
Nexus
├── frontend/             # Next.js 14+ App Router initialized workspace
│   ├── app/              # Next.js pages & styles
│   └── package.json
└── server/               # Node.js + Express TypeScript initialized backend
    ├── prisma/           # Prisma DB schema
    ├── src/
    │   └── server.ts     # Minimal Express + Socket.io entry point
    └── package.json
```
