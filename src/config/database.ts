import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** Remote Hostinger DB + multi-step ledger work needs more than Prisma's 5s default. */
export const TX_OPTS = { maxWait: 15000, timeout: 30000 };

export default prisma;
