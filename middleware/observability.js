const crypto = require('crypto');
const logger = require('../config/winston');
const { observeRequest } = require('../services/observability');

function requestId(req) {
  const supplied = String(req.get('x-request-id') || '').trim();
  return /^[A-Za-z0-9._:-]{8,100}$/.test(supplied) ? supplied : crypto.randomUUID();
}

module.exports = function observabilityMiddleware(req, res, next) {
  const id = requestId(req);
  const started = process.hrtime.bigint();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    observeRequest(durationMs, res.statusCode);
    const userId = req.user?.id || req.authContext?.userId || null;
    const organizationId = req.user?.active_org_id || req.authContext?.organizationId || null;
    const body = {
      event: 'http_request', timestamp: new Date().toISOString(), request_id: id,
      route: req.route?.path || req.originalUrl.split('?')[0], method: req.method,
      status: res.statusCode, duration_ms: Number(durationMs.toFixed(2)),
      ...(userId ? { user_id: userId } : {}), ...(organizationId ? { organization_id: organizationId } : {}),
      ...(req.body?.market_id || req.query?.market_id ? { market: req.body?.market_id || req.query?.market_id } : {}),
      ...(req.body?.zone || req.query?.zone ? { zone: req.body?.zone || req.query?.zone } : {}),
    };
    logger.info('http_request', body);
  });
  next();
};
