import { PrismaClient } from '@prisma/client'

// Next dev reloads modules on every edit; without the global cache each reload
// opens a fresh pool and Neon runs out of connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
