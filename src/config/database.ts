import { PrismaClient } from '@prisma/client';
import { isProduction } from './env';
import { logger } from './logger';

/**
 * Single shared Prisma client instance for the whole application.
 * BACKEND-01 §6 — "Database access should use Prisma only."
 */
export const prisma = new PrismaClient({
  log: isProduction ? [{ emit: 'event', level: 'error' }] : [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
});

prisma.$on('error' as never, (e: unknown) => {
  logger.error('Prisma error', { error: e });
});
prisma.$on('warn' as never, (e: unknown) => {
  logger.warn('Prisma warning', { warning: e });
});

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Database connection established');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database connection closed');
}
