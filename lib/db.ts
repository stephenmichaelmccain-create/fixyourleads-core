import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function withConnectionGuard(url?: string) {
  if (!url || !url.startsWith('postgres')) {
    return url;
  }

  try {
    const parsed = new URL(url);

    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', '1');
    }

    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '20');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const guardedDatabaseUrl = withConnectionGuard(process.env.DATABASE_URL);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient(
    guardedDatabaseUrl
      ? {
          datasources: {
            db: {
              url: guardedDatabaseUrl
            }
          }
        }
      : undefined
  );

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
