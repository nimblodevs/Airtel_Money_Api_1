// ─────────────────────────────────────────────────────────────────────────
// logger.js
//
// A small structured logger. Every log line is a single JSON object with a
// timestamp, level, message, and any extra fields you pass in — that makes
// logs easy to grep, and easy to ship into something like CloudWatch/Loki
// later without changing any application code.
//
// SECURITY: this file also owns `redact()`, which strips secrets and PII
// (phone numbers, tokens, client secrets) out of anything we log. Every
// other file that logs request/response payloads should route them through
// redact() first — see its usage in the Airtel services and controllers.
// ─────────────────────────────────────────────────────────────────────────

import env from './env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = LEVELS[env.logLevel] ?? LEVELS.info;

// Object keys that should never appear in a log line, whatever their value.
const SENSITIVE_KEYS = new Set([
  'client_secret',
  'clientSecret',
  'access_token',
  'accessToken',
  'authorization',
  'password',
  'pin',
]);

/**
 * Deep-clones a value while masking sensitive fields and phone numbers, so
 * it's safe to pass straight into a log line. Never mutates the original.
 */
export function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => {
        if (SENSITIVE_KEYS.has(key)) return [key, '[REDACTED]'];
        if (key === 'msisdn' && typeof val === 'string') return [key, maskMsisdn(val)];
        return [key, redact(val)];
      })
    );
  }

  return value;
}

/** Turns "733123456" into "733***456" so logs never contain a full,
 *  directly-dialable subscriber number. */
function maskMsisdn(msisdn) {
  if (msisdn.length < 6) return '***';
  return `${msisdn.slice(0, 3)}***${msisdn.slice(-3)}`;
}

function write(level, message, meta = {}) {
  if (LEVELS[level] < currentLevel) return;

  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redact(meta),
  };

  // console.error for warn/error so they show up in stderr-based log
  // collectors separately from normal request logs.
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

const logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};

export default logger;
