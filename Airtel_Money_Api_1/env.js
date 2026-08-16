// ─────────────────────────────────────────────────────────────────────────
// env.js
//
// Single place that reads process.env and turns it into a typed-ish config
// object. Every other file imports FROM HERE instead of touching
// process.env directly — that way, if a critical variable is missing, we
// find out immediately on startup instead of getting a confusing
// "undefined" error deep inside an Airtel API call later.
// ─────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';

dotenv.config();

/**
 * Reads an env var and throws a clear error if it's missing.
 * Use for anything the app truly cannot run without.
 */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}. Did you copy .env.example to .env?`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// SECURITY: in production we refuse to boot without a callback-verification
// secret, since /api/payments/callback is a public, unauthenticated-by-Airtel
// endpoint that updates payment state — see middleware/verifyCallback.js.
const callbackVerifyToken = process.env.CALLBACK_VERIFY_TOKEN || '';
if (isProduction && !callbackVerifyToken) {
  throw new Error(
    'CALLBACK_VERIFY_TOKEN is required in production — it protects /api/payments/callback ' +
      'from being spoofed by anyone who finds the URL.'
  );
}

// Comma-separated list of origins allowed to call this API from a browser,
// e.g. "https://app.yourhospital.co.ke,https://admin.yourhospital.co.ke".
// SECURITY: don't default this to "*" in production — that lets ANY website
// call your payment endpoints from a user's browser.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (isProduction && allowedOrigins.length === 0) {
  throw new Error('ALLOWED_ORIGINS is required in production (comma-separated list of origins).');
}

const env = {
  port: process.env.PORT || 4000,
  nodeEnv,
  isProduction,
  logLevel: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  allowedOrigins,

  // Postgres connection string, e.g. postgresql://user:pass@host:5432/dbname
  databaseUrl: required('DATABASE_URL'),

  airtel: {
    // Sandbox vs production Airtel host. Stay on sandbox
    // (openapiuat.airtel.africa) until KYC is approved for production.
    baseUrl: process.env.AIRTEL_BASE_URL || 'https://openapiuat.airtel.africa',

    // Issued from the Airtel developer portal under "Key Management".
    // Never logged, never sent to the client — see logger.js redaction.
    clientId: required('AIRTEL_CLIENT_ID'),
    clientSecret: required('AIRTEL_CLIENT_SECRET'),

    country: process.env.AIRTEL_COUNTRY || 'KE',
    currency: process.env.AIRTEL_CURRENCY || 'KES',

    // Public HTTPS URL Airtel calls when a transaction resolves.
    callbackUrl: process.env.AIRTEL_CALLBACK_URL || '',
  },

  // Shared secret WE control, required as a header on our own callback
  // route. Airtel's callback payload isn't cryptographically signed, so
  // this is your main defense against someone spoofing a "payment
  // succeeded" callback — see middleware/verifyCallback.js for how it's
  // enforced, and README for how to configure it at your reverse proxy
  // or firewall level (e.g. only allow Airtel's IP ranges + this header).
  callbackVerifyToken,
};

export default env;
