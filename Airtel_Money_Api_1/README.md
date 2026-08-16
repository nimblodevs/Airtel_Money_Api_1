# Airtel Money API — Node.js + Express + Prisma + PostgreSQL

Wraps two Airtel Money Open API endpoints:

- **Collection Request** (`POST /merchant/v1/payments/`) — pushes an STK-style prompt to the payer's phone; they enter their Airtel Money PIN to approve.
- **Transaction Enquiry** (`GET /standard/v1/payments/{id}`) — polls the status of a previously-initiated transaction.

Plus a `/callback` route for Airtel's async result notification, and a Postgres-backed `Transaction` table (via Prisma) tracking every attempt.

> **Module system:** this project uses native ES Modules (`import`/`export`),
> enabled via `"type": "module"` in `package.json` — matching modern
> React/Vite-style syntax rather than older `require()`/`module.exports`.
> Requires Node.js 18+.

## 1. Setup

```bash
npm install
cp .env.example .env   # then fill in real values
```

Fill in `.env`:
- `DATABASE_URL` — your Postgres connection string
- `AIRTEL_CLIENT_ID` / `AIRTEL_CLIENT_SECRET` — from the Airtel developer portal ("Key Management")
- `AIRTEL_BASE_URL` — leave as the sandbox URL until you've completed KYC for production
- `AIRTEL_COUNTRY` / `AIRTEL_CURRENCY` — `KE` / `KES` for Kenya
- `ALLOWED_ORIGINS` — comma-separated frontend origins allowed to call this API (required in production)
- `CALLBACK_VERIFY_TOKEN` — a long random secret protecting `/api/payments/callback` (required in production; generate with `openssl rand -hex 32`)

## 2. Database

```bash
npx prisma migrate dev --name init
npx prisma generate
```

## 3. Run

```bash
npm run dev
```

## 4. Endpoints

### Initiate a payment
```
POST /api/payments/collect
Content-Type: application/json

{
  "msisdn": "733123456",
  "amount": 500,
  "reference": "Consultation fee - INV-1029"
}
```
`msisdn` is 9 digits, no leading `0` and no country code. Returns `202` immediately — the transaction is `PENDING` until the subscriber approves on their phone.

### Check status
```
GET /api/payments/status/:airtelTxnId
```
Actively calls Airtel's Transaction Enquiry API and updates the DB record. Once a transaction is `SUCCESS` or `FAILED` it's treated as final and won't re-query Airtel.

### Callback (Airtel → you)
```
POST /api/payments/callback
```
Register this URL (`AIRTEL_CALLBACK_URL` in your notes, configured on Airtel's side per their onboarding process) so Airtel pushes the final result the moment the subscriber acts, instead of you having to poll. During local dev, tunnel it with `ngrok http 4000` and register the tunnel URL.

## How the two confirmation paths fit together

Airtel doesn't guarantee callback delivery, so treat **both** paths as valid ways to reach a final state:

1. Call `/collect` → transaction saved as `PENDING`.
2. Either:
   - Airtel calls your `/callback` with the final result (fastest), **or**
   - You poll `/status/:airtelTxnId` on a schedule (e.g. every 5–10s, up to N attempts) until it's no longer `PENDING`.
3. Whichever arrives first wins — both handlers write to the same row keyed on `airtelTxnId`, so there's no double-processing risk, just an update.

For a real app, wire the frontend to poll `/status/:airtelTxnId` after calling `/collect`, so the user sees a spinner until it resolves — same UX pattern as M-Pesa STK push.

## Security measures in this codebase

- **Callback authentication** — `/api/payments/callback` requires an `X-Callback-Token` header matching `CALLBACK_VERIFY_TOKEN`, compared with a timing-safe check (`middleware/verifyCallback.js`). Airtel's callback payloads aren't signed, so this (plus restricting the route at your reverse proxy/firewall to Airtel's IP ranges, if available) is your main defense against spoofed "payment succeeded" callbacks.
- **CORS allow-list** — only origins listed in `ALLOWED_ORIGINS` can call the API from a browser; the app refuses to boot in production without this set.
- **Rate limiting** — `/collect` (10/min/IP) and `/status/:id` (60/min/IP) via `express-rate-limit`, both proxy-aware (`app.set('trust proxy', 1)`).
- **Input validation** — every request body/param is checked with Zod before it reaches Airtel or the database (`utils/validation.js`), including a UUID check on `:airtelTxnId` so malformed lookups never hit Prisma.
- **Security headers** — `helmet()` on every response.
- **Request size limits** — JSON bodies capped at 20kb (`express.json({ limit: '20kb' })`).
- **Secrets & PII never logged** — `config/logger.js` redacts `client_secret`, `access_token`, `authorization`, `pin`, and masks phone numbers (`733***456`) in every log line.
- **No leaked internals in production** — 5xx errors return a generic message to the client in production; the real error, stack trace, and a `requestId` are logged server-side only (`middleware/errorHandler.js`).
- **Timeouts everywhere** — every outbound Airtel call has a 15s timeout, so a hung upstream can't tie up your server indefinitely.
- **Graceful shutdown + crash visibility** — `server.js` handles `SIGTERM`/`SIGINT` (closes the DB connection cleanly) and logs `uncaughtException`/`unhandledRejection` before exiting, instead of dying silently.

### Still worth adding before production
- A background job (cron/BullMQ) that re-polls any transaction still `PENDING` after e.g. 2 minutes, in case the callback never arrives and the frontend gave up polling.
- Restricting `/api/payments/callback` at the network level (firewall/reverse proxy) to Airtel's published IP ranges, on top of the shared-secret check.
- Rotating `CALLBACK_VERIFY_TOKEN` and `AIRTEL_CLIENT_SECRET` periodically, and pulling them from a secrets manager rather than a `.env` file in production.

## Notes / things to verify against your live sandbox account

- **Exact status codes** (`TS`/`TF`/`TA`/`TIP`) and the callback payload shape have varied slightly across Airtel's country rollouts and API versions — the mapping in `airtelPayment.service.js` (`AIRTEL_STATUS_MAP`) is a starting point; log a few real sandbox responses and adjust.
- **Production access** requires KYC approval through Airtel — sandbox (`openapiuat.airtel.africa`) works without it.
- Amounts for KES are whole numbers (no decimals) in Airtel's payload — the Prisma column stores `Decimal` for safety, but validate/round before sending.
- Consider adding a background job (cron/BullMQ) that re-polls any transaction still `PENDING` after e.g. 2 minutes, in case the callback never arrives and the frontend gave up polling.
