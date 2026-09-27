const crypto = require('crypto');
const { pool } = require('../config/db.mysql');

const API_KEY_PREFIX = 'me_';
const API_KEY_BYTES = 32;

function generateApiKey({ sandbox = false } = {}) {
  const mode = sandbox ? 'test' : 'live';
  return `${API_KEY_PREFIX}${mode}_${crypto.randomBytes(API_KEY_BYTES).toString('hex')}`;
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function apiKeyMode(key) {
  const value = String(key || '');
  if (value.startsWith('me_test_')) return 'sandbox';
  if (value.startsWith('me_live_')) return 'live';
  return null;
}

function parseExpiry(expiresInDays) {
  if (expiresInDays === undefined || expiresInDays === null || expiresInDays === '') return null;
  const days = Number(expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    const e = new Error('expires_in_days must be an integer between 1 and 3650');
    e.status = 400;
    throw e;
  }
  return new Date(Date.now() + days * 86400000);
}

async function createOrganization({ name, marketId, ownerUserId, sandbox = false }) {
  const [r] = await pool.execute(
    'INSERT INTO organizations (name,market_id,owner_user_id,sandbox_flag) VALUES (?,?,?,?)',
    [name, marketId || null, ownerUserId, sandbox ? 1 : 0]
  );
  await pool.execute(
    'INSERT INTO organization_members (organization_id,user_id,role) VALUES (?,?,\'owner\')',
    [r.insertId, ownerUserId]
  );
  return r.insertId;
}

async function requireOrgMember(userId, orgId, roles = ['owner','dispatcher']) {
  const [[row]] = await pool.execute(
    `SELECT o.*,m.role FROM organizations o
     JOIN organization_members m ON m.organization_id=o.id
     WHERE o.id=? AND m.user_id=? AND m.role IN (${roles.map(() => '?').join(',')})`,
    [orgId, userId, ...roles]
  );
  if (!row) {
    const e = new Error('Organization access denied');
    e.status = 403;
    throw e;
  }
  return row;
}

async function authenticateApiKey(key) {
  if (!key) return null;
  const mode = apiKeyMode(key);
  if (!mode) return null;
  const hash = hashApiKey(key);
  const [[row]] = await pool.execute(
    `SELECT o.*, k.id AS api_key_id, k.key_prefix, k.expires_at, k.revoked_at,
            om.user_id, om.role
       FROM organization_api_keys k
       JOIN organizations o ON o.id=k.organization_id
       JOIN organization_members om
         ON om.organization_id=o.id
        AND om.user_id=k.created_by
      WHERE k.key_hash=?
        AND k.active=TRUE
        AND k.revoked_at IS NULL
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
        AND ((o.sandbox_flag=TRUE AND ?='sandbox') OR (o.sandbox_flag=FALSE AND ?='live'))
      LIMIT 1`,
    [hash, mode, mode]
  );
  if (!row) return null;
  await pool.execute(
    'UPDATE organization_api_keys SET last_used_at=NOW() WHERE id=? AND revoked_at IS NULL',
    [row.api_key_id]
  );
  return {
    ...row,
    authType: 'api_key',
    mode,
    sandbox: mode === 'sandbox',
    organizationId: Number(row.id),
    userId: Number(row.user_id),
    memberRole: row.role
  };
}

module.exports = {
  generateApiKey,
  hashApiKey,
  apiKeyMode,
  parseExpiry,
  createOrganization,
  requireOrgMember,
  authenticateApiKey
};
