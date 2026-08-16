// ─────────────────────────────────────────────────────────────────────────
// transaction.service.js
//
// All database reads/writes for the `Transaction` table live here. The
// controller never talks to Prisma directly — it calls these functions
// instead, keeping "how do we store this" separate from "what does the
// HTTP request/response look like".
// ─────────────────────────────────────────────────────────────────────────

import prisma from '../config/prisma.js';
import logger from '../config/logger.js';

/**
 * Saves a brand-new transaction right after sending the Collection Request
 * to Airtel. Starts as "PENDING" — nobody has approved/declined it yet.
 */
export async function createPendingTransaction({
  reference,
  airtelTxnId,
  msisdn,
  amount,
  currency,
  country,
  requestPayload,
  initResponse,
}) {
  try {
    const txn = await prisma.transaction.create({
      data: {
        reference,
        airtelTxnId,
        msisdn,
        amount,
        currency,
        country,
        status: 'PENDING',
        requestPayload,
        initResponse,
      },
    });
    logger.info('Transaction record created', { reference, airtelTxnId, status: 'PENDING' });
    return txn;
  } catch (err) {
    // Prisma error P2002 = unique constraint violation. Most likely cause
    // here: a duplicate `reference` was reused by the caller.
    if (err.code === 'P2002') {
      logger.warn('Duplicate transaction reference/airtelTxnId rejected by database', {
        reference,
        airtelTxnId,
        target: err.meta?.target,
      });
      const conflict = new Error('A transaction with this reference already exists.');
      conflict.statusCode = 409;
      throw conflict;
    }
    throw err;
  }
}

/** Look up a transaction by Airtel's own transaction id. */
export function findByAirtelTxnId(airtelTxnId) {
  return prisma.transaction.findUnique({ where: { airtelTxnId } });
}

/** Look up a transaction by our own reference string. */
export function findByReference(reference) {
  return prisma.transaction.findUnique({ where: { reference } });
}

/**
 * Updates a transaction's status as new information comes in — either from
 * us polling Airtel, or from Airtel's async callback. Only the fields you
 * pass get updated; anything left undefined is untouched.
 */
export async function updateStatus(
  airtelTxnId,
  { status, statusMessage, callbackPayload, lastQueryResponse, incrementQueryAttempt }
) {
  const updated = await prisma.transaction.update({
    where: { airtelTxnId },
    data: {
      ...(status && { status }),
      ...(statusMessage !== undefined && { statusMessage }),
      ...(callbackPayload && { callbackPayload }),
      ...(lastQueryResponse && { lastQueryResponse }),
      ...(incrementQueryAttempt && { queryAttempts: { increment: 1 } }),
    },
  });

  if (status) {
    logger.info('Transaction status updated', { airtelTxnId, status });
  }

  return updated;
}
