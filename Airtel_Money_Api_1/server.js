// ─────────────────────────────────────────────────────────────────────────
// server.js
//
// The actual entrypoint (`npm run dev` / `npm start` runs this file).
// Kept separate from app.js so app.js stays a plain, testable Express app.
//
// Also owns:
//   - top-level crash handlers, so an unexpected error is logged with full
//     context before the process exits, instead of Node printing a bare
//     stack trace (or worse, silently limping on in a broken state)
//   - graceful shutdown, so in-flight requests get a chance to finish and
//     the database connection closes cleanly when the process is stopped
//     (e.g. during a deploy, or `docker stop`)
// ─────────────────────────────────────────────────────────────────────────

import app from './app.js';
import env from './config/env.js';
import logger from './config/logger.js';
import prisma from './config/prisma.js';

const server = app.listen(env.port, () => {
  logger.info(`Airtel Money API listening on port ${env.port} (${env.nodeEnv})`);
});

// Catches errors that slip through every other safety net (asyncHandler,
// try/catch, etc). We log with full detail and exit — trying to keep
// running after an uncaught exception risks the process being in a
// corrupted, unpredictable state.
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection — shutting down', {
    reason: reason instanceof Error ? reason.message : reason,
  });
  process.exit(1);
});

/**
 * Runs when the process receives a termination signal (Ctrl+C locally, or
 * SIGTERM from a process manager/container orchestrator during a deploy).
 * Stops accepting new connections, lets existing ones finish, then closes
 * the database connection before actually exiting.
 */
function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);

  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Safety net: if something hangs and 'close' never fires, force-exit
  // rather than leaving a zombie process behind.
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
