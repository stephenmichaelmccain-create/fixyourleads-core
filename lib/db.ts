import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function withSafeConnectionLimit(url?: string) {
  if (!url || !url.startsWith('postgres')) {
    return url;
  }

  try {
    const parsed = new URL(url);

    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', '1');
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

const databaseUrl = withSafeConnectionLimit(process.env.DATABASE_URL);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient(
    databaseUrl
      ? {
          datasources: {
            db: {
              url: databaseUrl
            }
          }
        }
      : undefined
  );

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
