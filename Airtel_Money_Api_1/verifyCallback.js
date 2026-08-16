// ─────────────────────────────────────────────────────────────────────────
// verifyCallback.js
//
// SECURITY: /api/payments/callback updates payment status based on
// whatever gets POSTed to it — and Airtel's callback payloads aren't
// cryptographically signed the way, say, a Stripe webhook is. Left
// unprotected, ANYONE who finds this URL could POST a fake "SUCCESS"
// callback for a made-up transaction id.
//
// This middleware requires a shared secret (CALLBACK_VERIFY_TOKEN, set by
// you) to be present in an `X-Callback-Token` header. You configure the
// *same* value in your reverse proxy / firewall rule that forwards Airtel's
// callback to you, so only requests that pass through that path succeed.
//
// We use crypto.timingSafeEqual instead of `===` to compare the token —
// a plain string comparison leaks timing information (it returns faster
// the sooner it finds a mismatched character), which an attacker could
// exploit to guess the secret one byte at a time. timingSafeEqual always
// takes the same amount of time regardless of where the strings differ.
// ─────────────────────────────────────────────────────────────────────────

import { timingSafeEqual } from 'node:crypto';
import env from '../config/env.js';
import logger from '../config/logger.js';

export default function verifyCallback(req, res, next) {
  // If no secret is configured (e.g. local sandbox testing without a proxy
  // in front), skip the check — env.js already refuses to boot without one
  // in production, so this path is dev-only.
  if (!env.callbackVerifyToken) {
    return next();
  }

  const provided = req.get('x-callback-token') || '';
  const expected = env.callbackVerifyToken;

  // timingSafeEqual requires both buffers to be the same length, so pad/
  // reject length mismatches before comparing.
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  const isValid =
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer);

  if (!isValid) {
    logger.warn('Rejected callback with invalid/missing X-Callback-Token', {
      requestId: req.id,
      ip: req.ip,
    });
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  next();
}
