// ─────────────────────────────────────────────────────────────────────────
// prisma.js
//
// Prisma Client talks to Postgres. Creating a new PrismaClient() opens a
// connection pool, so we want exactly ONE instance for the whole app —
// every file that needs the database imports this shared instance instead
// of creating its own.
// ─────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import env from './env.js';
import logger from './logger.js';

const prisma = new PrismaClient({
  log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
});

// Log slow/failed connections instead of failing silently.
prisma
  .$connect()
  .then(() => logger.info('Connected to Postgres'))
  .catch((err) => {
    logger.error('Failed to connect to Postgres', { error: err.message });
    // Fail fast: a payment API with no database is worse than one that
    // won't start at all.
    process.exit(1);
  });

export default prisma;
