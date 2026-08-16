// ─────────────────────────────────────────────────────────────────────────
// airtelAuth.service.js
//
// Handles logging in to Airtel's API (OAuth2 "client_credentials" grant).
//
// How it works:
//   1. We POST our client_id + client_secret to Airtel's /auth/oauth2/token
//      endpoint.
//   2. Airtel gives back a short-lived "access_token" (a bearer token,
//      usually valid for ~1 hour).
//   3. We attach that token as `Authorization: Bearer <token>` on every
//      other Airtel API call.
//
// Because fetching a token is a network call, and the token stays valid for
// ~1 hour, we CACHE it in memory instead of fetching a fresh one per
// request. That's what `cachedToken` is for.
//
// SECURITY: the token itself is never logged (see logger.js redaction),
// and client_secret never leaves this file except inside the HTTPS request
// body sent directly to Airtel.
// ─────────────────────────────────────────────────────────────────────────

import axios from 'axios';
import env from '../config/env.js';
import logger from '../config/logger.js';

// Module-level variable = lives in memory for as long as the server runs.
// Shape: { accessToken: string, expiresAt: number (ms timestamp) } | null
let cachedToken = null;

// Refresh the token slightly BEFORE it actually expires, so we never fire
// off an API call with a token that dies mid-flight.
const SAFETY_MARGIN_MS = 60 * 1000; // 60 seconds

/**
 * Calls Airtel's token endpoint and stores the result in `cachedToken`.
 * Always fetches a fresh token — used internally when the cache is empty
 * or stale.
 */
async function fetchNewToken() {
  const url = `${env.airtel.baseUrl}/auth/oauth2/token`;

  try {
    const { data } = await axios.post(
      url,
      {
        client_id: env.airtel.clientId,
        client_secret: env.airtel.clientSecret,
        grant_type: 'client_credentials',
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10_000 }
    );

    // `expires_in` is in SECONDS — convert to milliseconds for Date.now() math.
    const expiresInMs = (Number(data.expires_in) || 3600) * 1000;

    cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresInMs - SAFETY_MARGIN_MS,
    };

    logger.info('Fetched new Airtel access token', { expiresInSeconds: data.expires_in });
    return cachedToken.accessToken;
  } catch (err) {
    logger.error('Failed to fetch Airtel access token', {
      status: err.response?.status,
      // err.response?.data may contain error details but never the token itself.
      data: err.response?.data,
    });
    throw err;
  }
}

/**
 * The function everything else calls. Returns a valid access token —
 * either the cached one (if still fresh) or a newly-fetched one.
 */
export async function getAccessToken() {
  const cacheIsStillValid = cachedToken && cachedToken.expiresAt > Date.now();
  if (cacheIsStillValid) return cachedToken.accessToken;
  return fetchNewToken();
}

/**
 * Wipes the cached token. Call this if an API request unexpectedly gets a
 * 401 — it means our cached token was rejected, so the next
 * getAccessToken() call is forced to fetch a fresh one.
 */
export function invalidateToken() {
  cachedToken = null;
  logger.warn('Airtel access token invalidated (received 401 from a downstream call)');
}
