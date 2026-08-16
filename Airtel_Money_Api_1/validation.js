// ─────────────────────────────────────────────────────────────────────────
// validation.js
//
// Zod schemas describing what valid input looks like. We validate BEFORE
// calling Airtel or the database — catching a bad phone number here is
// instant and free; catching it after we've already called Airtel wastes
// an API call (and might send a bogus PIN prompt to someone's phone).
//
// SECURITY: validating route params (like an id used in a DB lookup) isn't
// just about correctness — it also stops obviously-malformed input from
// even reaching Prisma, which is good defensive practice even though
// Prisma's parameterized queries already prevent SQL injection.
// ─────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

// Kenyan Airtel numbers, entered WITHOUT the country code and WITHOUT the
// leading 0. Airtel Kenya numbers start with 7 or 1 and are 9 digits total,
// e.g. "733123456" (not "0733123456", not "+254733123456").
export const msisdnSchema = z
  .string()
  .trim()
  .regex(/^(7|1)\d{8}$/, 'msisdn must be 9 digits, no leading 0 or country code (e.g. 733123456)');

export const initiatePaymentSchema = z.object({
  msisdn: msisdnSchema,
  amount: z
    .number()
    .positive()
    .max(500_000, 'amount exceeds a sane single-transaction cap')
    // Airtel's KES payloads are whole numbers — reject fractional amounts
    // up front rather than letting them reach the payment provider.
    .refine((n) => Number.isInteger(n), 'amount must be a whole number for this currency'),
  reference: z
    .string()
    .trim()
    .min(1)
    .max(100)
    // Keep references to a safe, predictable character set — they get
    // logged, stored, and sent on to a third-party API.
    .regex(/^[\w\s\-.:#/]+$/, 'reference contains unsupported characters')
    .optional(),
});

// Our own transaction ids are UUIDv4 (see uuid usage in the controller) —
// validating the :airtelTxnId route param against that shape means a
// junk/scanning request (e.g. someone probing ../ or SQL-ish strings)
// gets a clean 400 instead of ever touching the database layer.
export const transactionIdParamSchema = z.string().uuid('must be a valid transaction id');
