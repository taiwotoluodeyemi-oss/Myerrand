const crypto = require('crypto');

const MAX_PAYLOAD_BYTES = Number(process.env.MERCHANT_MAX_PAYLOAD_BYTES || 64 * 1024);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function stableNormalize(value) {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableNormalize(value[key]);
      return out;
    }, {});
  }
  return value;
}

function requestFingerprint({ method, path, body, organizationId = null, mode = 'live' }) {
  const canonical = JSON.stringify(stableNormalize({
    method: String(method || '').toUpperCase(),
    path: String(path || ''),
    organizationId: organizationId == null ? null : Number(organizationId),
    mode,
    body: body || {}
  }));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function validateIdempotencyKey(value) {
  if (value == null || value === '') return null;
  const key = String(value).trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    const e = new Error('Idempotency-Key must be 8-160 characters and contain only letters, numbers, ., _, :, or -');
    e.status = 400;
    throw e;
  }
  return key;
}

function parsePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1);
  const requested = Number.parseInt(query.limit || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));
  return { page, limit, offset: (page - 1) * limit };
}

function rejectOversizedPayload(req, res, next) {
  const length = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(length) && length > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ success: false, error: 'Request payload too large' });
  }
  next();
}

module.exports = {
  MAX_PAYLOAD_BYTES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  requestFingerprint,
  validateIdempotencyKey,
  parsePagination,
  rejectOversizedPayload
};
