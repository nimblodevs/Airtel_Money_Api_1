// ─────────────────────────────────────────────────────────────────────────
// asyncHandler.js
//
// Express doesn't automatically catch rejected promises thrown inside
// `async` route handlers — without this wrapper, a thrown error inside an
// `await` would crash the process instead of being handled gracefully by
// errorHandler.js. Wrapping every async controller with this means we
// never have to remember to write try/catch { next(err) } by hand.
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {(req, res, next) => Promise<any>} fn
 * @returns {(req, res, next) => void}
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
