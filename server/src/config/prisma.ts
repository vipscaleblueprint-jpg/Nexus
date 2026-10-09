import './env'; // load DATABASE_URL before it's read below, regardless of import order
import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client.
 *
 * Every module that instantiates its own `new PrismaClient()` opens a separate
 * connection pool, which exhausts Postgres connections quickly under tsx watch
 * reloads. Import this instead.
 *
 * Pool tuning: the database is remote (~190 ms round trip) and capped at 100 connections that are
 * shared by every environment (local dev servers, Prisma Studio, the VPS app). Prisma's default
 * pool size is `cores * 2 + 1` — 33 per process on a 16-core dev machine — so a couple of
 * processes alone could exhaust Postgres, after which new connections fail intermittently.
 * These defaults are only applied when DATABASE_URL doesn't already set the parameter, so any
 * environment can still override them in its URL.
 */
const POOL_DEFAULTS: Record<string, string> = {
  connection_limit: '10', // connections per process
  pool_timeout: '20', // seconds to wait for a free pooled connection before erroring
  connect_timeout: '15', // seconds to open a new connection over the WAN (Prisma default: 5)
  max_idle_connection_lifetime: '300', // seconds; recycle idle sockets before NATs/firewalls silently drop them
  application_name: 'nexus-api', // identifies these connections in pg_stat_activity
};

function withPoolDefaults(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    for (const [key, value] of Object.entries(POOL_DEFAULTS)) {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return rawUrl; // unparseable URL: leave it exactly as configured
  }
}

const databaseUrl = withPoolDefaults(process.env.DATABASE_URL);

export const prisma = new PrismaClient(
  databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined
);
