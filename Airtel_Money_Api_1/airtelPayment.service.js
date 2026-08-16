// ─────────────────────────────────────────────────────────────────────────
// airtelPayment.service.js
//
// The actual Airtel Money API calls: requesting a payment (Collection),
// and checking whether it succeeded (Transaction Enquiry).
//
// This file does NOT touch the database and does NOT know about Express
// req/res — it's a pure "talk to Airtel" module, which makes it possible
// to unit-test or reuse without spinning up a whole HTTP server.
// ─────────────────────────────────────────────────────────────────────────

import axios from 'axios';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { getAccessToken, invalidateToken } from './airtelAuth.service.js';

// SECURITY / RELIABILITY: never let a hung network call block a request
// forever — Airtel (or the network path to it) can stall, and without a
// timeout that stall would tie up our request-handling resources too.
const REQUEST_TIMEOUT_MS = 15_000;

function authHeaders(accessToken, extraHeaders = {}) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: '*/*',
    'X-Country': env.airtel.country,
    'X-Currency': env.airtel.currency,
    ...extraHeaders,
  };
}

/**
 * STEP 1 of a payment: ask Airtel to prompt the subscriber's phone for
 * their PIN ("Collection Request", a.k.a. STK push). This call only tells
 * you Airtel ACCEPTED the request — not that money actually moved. Poll
 * queryTransactionStatus() or wait for the callback to learn the outcome.
 *
 * @param {Object} params
 * @param {string} params.msisdn        9 digits, no leading 0 / country code
 *                                       (e.g. "733123456" for Kenya).
 * @param {number} params.amount        Whole-unit amount (KES has no decimals).
 * @param {string} params.transactionId Our unique ID — becomes Airtel's transaction.id.
 * @param {string} params.reference     Short human-readable description.
 */
export async function initiateCollection({ msisdn, amount, transactionId, reference }) {
  const url = `${env.airtel.baseUrl}/merchant/v1/payments/`;

  const payload = {
    reference,
    subscriber: {
      country: env.airtel.country,
      currency: env.airtel.currency,
      msisdn,
    },
    transaction: {
      amount,
      country: env.airtel.country,
      currency: env.airtel.currency,
      id: transactionId,
    },
  };

  const token = await getAccessToken();
  logger.info('Initiating Airtel collection request', { transactionId, msisdn, amount });

  try {
    const { data } = await axios.post(url, payload, {
      headers: authHeaders(token),
      timeout: REQUEST_TIMEOUT_MS,
    });
    logger.info('Airtel collection request accepted', { transactionId, airtelStatus: data?.status });
    return { payload, response: data };
  } catch (err) {
    // If our cached token had just expired, Airtel rejects with 401.
    // Fetch a fresh token and retry exactly once before giving up.
    if (err.response?.status === 401) {
      invalidateToken();
      const freshToken = await getAccessToken();
      const { data } = await axios.post(url, payload, {
        headers: authHeaders(freshToken),
        timeout: REQUEST_TIMEOUT_MS,
      });
      return { payload, response: data };
    }
    throw normalizeAirtelError(err, { transactionId, stage: 'initiateCollection' });
  }
}

/**
 * STEP 2 of a payment: ask Airtel "what happened to this transaction?"
 * Use this to poll after initiateCollection(), or as a fallback if the
 * async callback never arrives.
 *
 * @param {string} transactionId Same id sent in initiateCollection().
 */
export async function queryTransactionStatus(transactionId) {
  const url = `${env.airtel.baseUrl}/standard/v1/payments/${transactionId}`;
  const token = await getAccessToken();

  try {
    const { data } = await axios.get(url, {
      headers: authHeaders(token),
      timeout: REQUEST_TIMEOUT_MS,
    });
    return data;
  } catch (err) {
    if (err.response?.status === 401) {
      invalidateToken();
      const freshToken = await getAccessToken();
      const { data } = await axios.get(url, {
        headers: authHeaders(freshToken),
        timeout: REQUEST_TIMEOUT_MS,
      });
      return data;
    }
    throw normalizeAirtelError(err, { transactionId, stage: 'queryTransactionStatus' });
  }
}

// Airtel returns short status codes on both the initial response and the
// enquiry response. We translate them into our own, more readable enum.
//
// ⚠️ Verify these against your own sandbox responses — Airtel's exact
// codes have varied slightly between countries / API versions.
const AIRTEL_STATUS_MAP = {
  TS: 'SUCCESS', // Transaction Successful
  TF: 'FAILED', // Transaction Failed
  TA: 'PENDING', // Transaction Ambiguous (still resolving)
  TIP: 'PENDING', // Transaction In Progress
};

/** Converts a raw Airtel status code into our internal status string. */
export function mapAirtelStatus(rawStatus) {
  if (!rawStatus) return 'PENDING';
  return AIRTEL_STATUS_MAP[rawStatus] ?? 'PENDING';
}

/**
 * Wraps an axios error into a plain Error with extra context attached
 * (Airtel's error body + HTTP status), and logs it — so a single call site
 * (the Express error handler) can format the client response, while we
 * still get a full record in the logs for debugging.
 */
function normalizeAirtelError(err, context = {}) {
  if (err.response) {
    logger.error('Airtel API request failed', {
      ...context,
      status: err.response.status,
      body: err.response.data,
    });

    const wrapped = new Error(
      `Airtel API error (${err.response.status}) during ${context.stage || 'request'}`
    );
    wrapped.airtelResponse = err.response.data;
    wrapped.statusCode = err.response.status >= 400 && err.response.status < 500 ? 502 : 502;
    // ^ We deliberately return 502 (Bad Gateway) to OUR client regardless of
    // Airtel's exact status — it accurately says "the upstream provider had
    // a problem", without leaking Airtel's internal status semantics.
    return wrapped;
  }

  // No `err.response` means the request never got a response at all —
  // network failure, DNS issue, or it hit REQUEST_TIMEOUT_MS.
  logger.error('Airtel API request errored with no response (timeout/network)', {
    ...context,
    error: err.message,
  });
  const wrapped = new Error(`Could not reach Airtel API during ${context.stage || 'request'}`);
  wrapped.statusCode = 504; // Gateway Timeout
  return wrapped;
}
