import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client.
 *
 * Every module that instantiates its own `new PrismaClient()` opens a separate
 * connection pool, which exhausts Postgres connections quickly under tsx watch
 * reloads. Import this instead.
 */
export const prisma = new PrismaClient();
