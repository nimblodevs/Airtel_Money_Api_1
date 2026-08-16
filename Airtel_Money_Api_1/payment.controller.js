// ─────────────────────────────────────────────────────────────────────────
// payment.controller.js
//
// The "glue" layer: reads the incoming HTTP request, calls the right
// service functions (Airtel API + database), and shapes the HTTP response.
// Wrapped with asyncHandler so any thrown/rejected error is automatically
// forwarded to errorHandler.js — no manual try/catch needed per function.
// ─────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import * as airtelPayment from '../services/airtelPayment.service.js';
import * as transactionService from '../services/transaction.service.js';
import { initiatePaymentSchema, transactionIdParamSchema } from '../utils/validation.js';
import asyncHandler from '../middleware/asyncHandler.js';
import env from '../config/env.js';
import logger from '../config/logger.js';

/** Builds a 400 error carrying Zod's field-level messages, in the shape
 *  errorHandler.js knows how to render. */
function validationError(zodError) {
  const err = new Error('Invalid request');
  err.statusCode = 400;
  err.fieldErrors = zodError.flatten().fieldErrors;
  return err;
}

/**
 * POST /api/payments/collect
 * Body: { msisdn, amount, reference? }
 *
 * Starts a payment: validates input, asks Airtel to prompt the subscriber's
 * phone, then saves a PENDING record so we (and the frontend) can track it.
 */
export const initiatePayment = asyncHandler(async (req, res) => {
  const parsed = initiatePaymentSchema.safeParse(req.body);
  if (!parsed.success) throw validationError(parsed.error);

  const { msisdn, amount, reference } = parsed.data;

  // Generate our own unique IDs server-side — never trust the client to
  // supply these, or a malicious/buggy client could collide or replay them.
  const transactionId = randomUUID();
  const txnReference = reference || `TXN-${Date.now()}`;

  const { payload, response } = await airtelPayment.initiateCollection({
    msisdn,
    amount,
    transactionId,
    reference: txnReference,
  });

  // Airtel's response usually echoes back the id we sent, but trust their
  // response if they return something different.
  const airtelTxnId = response?.data?.transaction?.id || transactionId;

  const saved = await transactionService.createPendingTransaction({
    reference: txnReference,
    airtelTxnId,
    msisdn,
    amount,
    currency: env.airtel.currency,
    country: env.airtel.country,
    requestPayload: payload,
    initResponse: response,
  });

  // 202 Accepted = "we've started the process, but it isn't finished yet".
  res.status(202).json({
    success: true,
    message: 'Payment request sent. Subscriber must approve on their phone.',
    transaction: {
      id: saved.id,
      reference: saved.reference,
      airtelTxnId: saved.airtelTxnId,
      status: saved.status,
    },
  });
});

/**
 * GET /api/payments/status/:airtelTxnId
 *
 * Actively asks Airtel "what's the latest on this transaction?" and syncs
 * our database record. The frontend can poll this every few seconds while
 * showing a "waiting for approval..." spinner.
 */
export const getPaymentStatus = asyncHandler(async (req, res) => {
  const idCheck = transactionIdParamSchema.safeParse(req.params.airtelTxnId);
  if (!idCheck.success) throw validationError(idCheck.error);
  const airtelTxnId = idCheck.data;

  const existing = await transactionService.findByAirtelTxnId(airtelTxnId);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Transaction not found' });
  }

  // Once we've reached a final state, there's nothing new to learn — skip
  // the extra Airtel API call and just return what we already know.
  if (existing.status === 'SUCCESS' || existing.status === 'FAILED') {
    return res.json({ success: true, transaction: serializeTxn(existing) });
  }

  const queryResponse = await airtelPayment.queryTransactionStatus(airtelTxnId);

  const rawStatus = queryResponse?.data?.transaction?.status;
  const mappedStatus = airtelPayment.mapAirtelStatus(rawStatus);
  const statusMessage =
    queryResponse?.data?.transaction?.message || queryResponse?.status?.message;

  const updated = await transactionService.updateStatus(airtelTxnId, {
    status: mappedStatus,
    statusMessage,
    lastQueryResponse: queryResponse,
    incrementQueryAttempt: true,
  });

  res.json({ success: true, transaction: serializeTxn(updated) });
});

/**
 * POST /api/payments/callback
 *
 * Airtel calls THIS endpoint once the subscriber has approved/declined/
 * ignored the prompt. Protected upstream by middleware/verifyCallback.js —
 * by the time this function runs, the shared-secret header has already
 * been checked.
 *
 * Always respond 200, even on a slightly malformed payload — returning an
 * error status can cause Airtel to keep retrying the same callback.
 */
export const handleCallback = asyncHandler(async (req, res) => {
  const body = req.body;

  // Expected shape (double-check against real sandbox payloads — this has
  // varied by country/API version):
  // { transaction: { id, message, status_code, airtel_money_id } }
  const airtelTxnId = body?.transaction?.id;

  if (!airtelTxnId) {
    logger.warn('Airtel callback missing transaction.id', { requestId: req.id, body });
    return res.status(200).json({ received: true });
  }

  const rawStatus = body?.transaction?.status_code || body?.transaction?.status;
  const mappedStatus = airtelPayment.mapAirtelStatus(rawStatus);

  const existing = await transactionService.findByAirtelTxnId(airtelTxnId);

  if (existing) {
    await transactionService.updateStatus(airtelTxnId, {
      status: mappedStatus,
      statusMessage: body?.transaction?.message,
      callbackPayload: body,
    });
  } else {
    // Shouldn't normally happen — log it for investigation (e.g. a replayed
    // or forged callback that got past verifyCallback for a bogus id).
    logger.warn('Callback received for unknown transaction', { requestId: req.id, airtelTxnId });
  }

  res.status(200).json({ received: true });
});

/**
 * Shapes a Prisma Transaction row into the plain object we send back over
 * the API — keeps internal DB fields separate from the public response shape.
 */
function serializeTxn(t) {
  return {
    id: t.id,
    reference: t.reference,
    airtelTxnId: t.airtelTxnId,
    msisdn: t.msisdn,
    amount: t.amount,
    currency: t.currency,
    status: t.status,
    statusMessage: t.statusMessage,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
