const crypto = require('crypto');
const { pool } = require('../config/db.mysql');

async function writeApiAudit({ req, action = 'request', statusCode = null, metadata = {} }) {
  try {
    await pool.execute(
      `INSERT INTO api_audit_logs
       (organization_id,api_key_id,actor_user_id,auth_mode,request_id,method,path,action,status_code,ip,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        req.auth?.organizationId || null,
        req.auth?.apiKeyId || null,
        req.auth?.userId || req.user?.id || null,
        req.auth?.type || 'jwt',
        req.requestId || null,
        req.method,
        req.originalUrl || req.path,
        action,
        statusCode,
        req.ip || null,
        JSON.stringify(metadata || {})
      ]
    );
  } catch (error) {
    console.error('[API AUDIT] write failed:', error.message);
  }
}

function attachApiAudit(req, res, action = 'request') {
  req.requestId = req.get('X-Request-ID') || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  res.once('finish', () => {
    void writeApiAudit({
      req,
      action,
      statusCode: res.statusCode,
      metadata: { mode: req.auth?.mode || 'live' }
    });
  });
}

module.exports = { writeApiAudit, attachApiAudit };
