import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

/**
 * Single Prisma client for the process. Query logging is limited to warnings
 * and errors so patient data is never written verbatim to stdout.
 */
export const prisma = new PrismaClient({
  log: config.isProduction ? ['error'] : ['warn', 'error'],
});

export type Db = typeof prisma;
