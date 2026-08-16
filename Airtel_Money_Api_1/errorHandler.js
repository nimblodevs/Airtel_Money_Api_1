// ─────────────────────────────────────────────────────────────────────────
// errorHandler.js
//
// Express "error middleware" — recognizable because it takes FOUR
// arguments (err, req, res, next) instead of the usual three. Whenever any
// route calls next(err) (or asyncHandler.js catches a rejected promise),
// execution jumps straight here.
//
// Having ONE place that formats error responses means:
//   - every route returns errors in the same consistent JSON shape
//   - we have one place to make sure we never leak stack traces / internal
//     details to the client in production
//   - every error gets logged with the requestId that ties it back to the
//     matching "Request started"/"Request finished" log lines
// ─────────────────────────────────────────────────────────────────────────

import env from '../config/env.js';
import logger from '../config/logger.js';

// eslint-disable-next-line no-unused-vars
export default function errorHandler(err, req, res, next) {
  const status = resolveStatusCode(err);

  logger.error('Request failed', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    statusCode: status,
    message: err.message,
    // Stack traces are verbose and can contain file paths / internals —
    // fine for our own logs, never sent to the client (see response below).
    stack: err.stack,
  });

  const responseBody = {
    success: false,
    message: publicMessage(err, status),
    requestId: req.id,
  };

  // Only include Zod-style field errors and Airtel's raw error body when
  // NOT in production — genuinely useful while developing/debugging in
  // Postman, but internal-detail leakage in a live environment.
  if (!env.isProduction) {
    if (err.fieldErrors) responseBody.errors = err.fieldErrors;
    if (err.airtelResponse) responseBody.airtelResponse = err.airtelResponse;
  }

  res.status(status).json(responseBody);
}

function resolveStatusCode(err) {
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 600) {
    return err.statusCode;
  }
  return 500;
}

/**
 * Decides what message the CLIENT sees. In production, a 500 always gets a
 * generic message — the real reason lives in the server logs only, since
 * detailed internal errors can help an attacker map out your system.
 * Errors we deliberately raised (4xx, with a clear message) are safe to
 * show as-is, since we wrote them to be user-facing in the first place.
 */
function publicMessage(err, status) {
  if (env.isProduction && status >= 500) {
    return 'Something went wrong on our end. Please try again shortly.';
  }
  return err.message || 'Internal server error';
}
