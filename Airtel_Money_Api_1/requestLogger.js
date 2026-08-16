// ─────────────────────────────────────────────────────────────────────────
// requestLogger.js
//
// Assigns every incoming request a short correlation id (req.id), logs
// when it starts and finishes (with status code + duration), and exposes
// req.id back to the client via an X-Request-Id header — so if a user
// reports "my payment failed", you can ask for that id and grep straight
// to the matching log lines instead of guessing which request was theirs.
// ─────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import logger from '../config/logger.js';

export default function requestLogger(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);

  const startedAt = Date.now();

  logger.info('Request started', { requestId: req.id, method: req.method, path: req.originalUrl });

  // 'finish' fires once Express has sent the full response — this is where
  // we know the final status code and total duration.
  res.on('finish', () => {
    logger.info('Request finished', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
}
