// ─────────────────────────────────────────────────────────────────────────
// payment.routes.js
//
// Maps URLs + HTTP methods to controller functions, and attaches
// route-specific middleware (rate limiting, callback verification).
// ─────────────────────────────────────────────────────────────────────────

import express from 'express';
import rateLimit from 'express-rate-limit';
import {
  initiatePayment,
  getPaymentStatus,
  handleCallback,
} from '../controllers/payment.controller.js';
import verifyCallback from '../middleware/verifyCallback.js';

const router = express.Router();

// SECURITY: every request here also sends a real approval prompt to
// someone's phone, so this isn't just about protecting our server from
// load — it stops the endpoint being used to spam a subscriber.
const collectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many payment requests, slow down.' },
});

// SECURITY: status lookups are cheap for us but could be used to enumerate/
// guess transaction ids if left unlimited (ids are UUIDs so guessing is
// impractical, but rate limiting is a cheap extra layer regardless).
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Start a new payment (pushes an approval prompt to the subscriber's phone).
router.post('/collect', collectLimiter, initiatePayment);

// Poll the current status of a payment we already started.
router.get('/status/:airtelTxnId', statusLimiter, getPaymentStatus);

// Airtel calls this URL automatically once a transaction resolves.
// verifyCallback checks the shared-secret header before the request body
// is ever trusted — see middleware/verifyCallback.js for why that matters.
router.post('/callback', verifyCallback, handleCallback);

export default router;
