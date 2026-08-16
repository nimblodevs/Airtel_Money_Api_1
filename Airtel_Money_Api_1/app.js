// ─────────────────────────────────────────────────────────────────────────
// app.js
//
// Builds the Express application: security headers, CORS, body parsing,
// request logging, routes, and error handling — in that order, since
// middleware order matters (e.g. errorHandler must be registered last).
//
// Deliberately does NOT call app.listen() here — that lives in server.js —
// so this file can be imported by tests later without starting a real
// server on a real port.
// ─────────────────────────────────────────────────────────────────────────

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import env from './config/env.js';
import logger from './config/logger.js';
import requestLogger from './middleware/requestLogger.js';
import paymentRoutes from './routes/payment.routes.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

// SECURITY: if this app runs behind a reverse proxy / load balancer (very
// likely in production — Nginx, Cloudflare, etc.), Express needs to know
// that so req.ip reflects the real client IP (from X-Forwarded-For)
// instead of the proxy's own IP. This matters for rate limiting and logs.
app.set('trust proxy', 1);

// SECURITY: sets a batch of protective HTTP headers (X-Content-Type-Options,
// X-Frame-Options, etc). contentSecurityPolicy is disabled because this is
// a pure JSON API with no HTML views to protect — CSP only matters for
// pages the app itself renders.
app.use(helmet({ contentSecurityPolicy: false }));

// SECURITY: only browsers running on an origin we've explicitly allow-listed
// can call this API. In development, with no ALLOWED_ORIGINS configured, we
// fall back to allowing any origin so local frontend dev isn't blocked.
app.use(
  cors({
    origin: env.allowedOrigins.length > 0 ? env.allowedOrigins : true,
  })
);

// SECURITY: cap request body size — an unbounded JSON body is an easy way
// for someone to send a huge payload and tie up memory/CPU. Our largest
// legitimate payload (Airtel's callback) is tiny, so 20kb is generous.
app.use(express.json({ limit: '20kb' }));

app.use(requestLogger);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/payments', paymentRoutes);

// Catch-all for any URL that didn't match a route above.
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Not found' });
});

// Must be registered LAST — Express only treats a 4-arg function as error
// middleware, and it only runs when something earlier calls next(err).
app.use(errorHandler);

logger.info('Express app configured', { nodeEnv: env.nodeEnv });

export default app;
