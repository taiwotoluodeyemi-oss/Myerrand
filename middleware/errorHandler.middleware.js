/**
 * Not found middleware - handles 404 errors
 */
const logger = require('../config/winston');
const { redact, record } = require('../services/observability');

function errorCategory(err, req) {
  if (err?.category) return err.category;
  const path = String(req?.originalUrl || '');
  if (/auth|login|token|mfa/i.test(path)) return 'AUTH_ERROR';
  if (/payment|deposit|withdraw|paystack|paypal/i.test(path)) return 'PAYMENT_ERROR';
  if (/money|wallet|refund|release|hold/i.test(path) || err?.code?.startsWith('MONEY_')) return 'MONEY_ERROR';
  if (/webhook/i.test(path)) return 'WEBHOOK_ERROR';
  if (err?.code && /^ER_/.test(err.code)) return 'DATABASE_ERROR';
  if (err?.status && err.status < 500) return 'VALIDATION_ERROR';
  return 'DATABASE_ERROR' === err?.category ? 'DATABASE_ERROR' : 'EXTERNAL_PROVIDER_ERROR' === err?.category ? 'EXTERNAL_PROVIDER_ERROR' : 'VALIDATION_ERROR' === err?.category ? 'VALIDATION_ERROR' : 'AUTH_ERROR' === err?.category ? 'AUTH_ERROR' : 'EXTERNAL_PROVIDER_ERROR';
}

const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

/**
 * Error handler middleware - processes all errors
 */
const errorHandler = (err, req, res, next) => {
  // Set status code (default to 500 if not already set)
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode);
  
  // Prepare response based on environment.
  // NOTE: the rest of the API (jsonResponse helper in errands/wallet routes)
  // responds with { success, data, error }. Frontend error handling reads
  // error.response.data.error (and in some places data.message) — so this
  // fallback handler includes both keys with the same value to match every
  // caller, instead of only the `message` key it used to send.
  const isProd = process.env.NODE_ENV === 'production';
  const response = {
    success: false,
    data: null,
    error: isProd ? (err.publicMessage || 'Internal server error') : err.message,
    message: isProd ? (err.publicMessage || 'Internal server error') : err.message,
  };
  if (!isProd) response.stack = err.stack;
  
  const category = errorCategory(err, req);
  record(`errors_${category.toLowerCase()}`);
  logger.error({ event: 'request_error', category, request_id: req.requestId || null, route: req.route?.path || req.originalUrl?.split('?')[0], method: req.method, status: statusCode, message: redact(err.message || 'Request failed').slice(0, 500), ...(req.user?.id ? { user_id: req.user.id } : {}), ...(req.user?.active_org_id ? { organization_id: req.user.active_org_id } : {}) });
  
  // Send response
  res.json(response);
};

module.exports = { notFound, errorHandler };
