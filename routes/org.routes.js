const express = require('express');
const { pool } = require('../config/db.mysql');
const { verifyToken, requireClient, requireAdmin } = require('../middleware/auth');
const {
  createOrganization, requireOrgMember, generateApiKey, hashApiKey, parseExpiry
} = require('../services/enterprise');
const { providerStatus, InsuranceProvider } = require('../services/providers');
const { auditSecurity } = require('../services/securityAudit');

const router = express.Router();

function safeError(error, fallback = 'Request failed') {
  if (error?.status) return error.message;
  return process.env.NODE_ENV === 'production' ? fallback : error?.message || fallback;
}

router.post('/', verifyToken, requireClient, async (req, res) => {
  try {
    const { name, market_id, sandbox_flag } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 180) {
      return res.status(400).json({ success: false, error: 'A valid organization name is required' });
    }
    const id = await createOrganization({
      name: name.trim(),
      marketId: market_id,
      ownerUserId: req.user.id,
      sandbox: Boolean(sandbox_flag)
    });
    await auditSecurity({
      actorId: req.user.id,
      action: 'organization_created',
      targetType: 'organization',
      targetId: id,
      details: { sandbox: Boolean(sandbox_flag) },
      req
    });
    res.status(201).json({
      success: true,
      organization: { id, name: name.trim(), market_id: market_id || null, sandbox_flag: Boolean(sandbox_flag) }
    });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.get('/', verifyToken, requireClient, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT o.id,o.name,o.market_id,o.sandbox_flag,o.created_at,m.role
         FROM organizations o
         JOIN organization_members m ON m.organization_id=o.id
        WHERE m.user_id=? ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, organizations: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: safeError(e) });
  }
});

router.post('/:id/members', verifyToken, requireClient, async (req, res) => {
  try {
    const org = await requireOrgMember(req.user.id, req.params.id, ['owner']);
    const { user_id, role = 'dispatcher' } = req.body || {};
    if (!user_id || !['owner', 'dispatcher'].includes(role)) {
      return res.status(400).json({ success: false, error: 'user_id and valid role are required' });
    }
    await pool.execute(
      `INSERT INTO organization_members (organization_id,user_id,role)
       VALUES (?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role)`,
      [org.id, user_id, role]
    );
    await auditSecurity({
      actorId: req.user.id,
      action: 'organization_membership_changed',
      targetType: 'organization',
      targetId: org.id,
      details: { user_id: Number(user_id), role },
      req
    });
    res.status(201).json({ success: true, organization_id: org.id, user_id: Number(user_id), role });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.get('/:id/members', verifyToken, requireClient, async (req, res) => {
  try {
    const org = await requireOrgMember(req.user.id, req.params.id);
    const [rows] = await pool.execute(
      'SELECT user_id,role,created_at FROM organization_members WHERE organization_id=? ORDER BY role,user_id',
      [org.id]
    );
    res.json({ success: true, members: rows });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.post('/:id/api-keys', verifyToken, requireClient, async (req, res) => {
  try {
    const org = await requireOrgMember(req.user.id, req.params.id, ['owner']);
    const expiresAt = parseExpiry(req.body?.expires_in_days);
    const key = generateApiKey({ sandbox: Boolean(org.sandbox_flag) });
    const [r] = await pool.execute(
      `INSERT INTO organization_api_keys
       (organization_id,key_prefix,key_hash,active,created_by,expires_at,mode)
       VALUES (?,?,?,?,?,?,?)`,
      [
        org.id, key.slice(0, 16), hashApiKey(key), 1, req.user.id,
        expiresAt, org.sandbox_flag ? 'sandbox' : 'live'
      ]
    );
    await auditSecurity({
      actorId: req.user.id,
      action: 'api_key_created',
      targetType: 'organization_api_key',
      targetId: r.insertId,
      details: { organization_id: org.id, mode: org.sandbox_flag ? 'sandbox' : 'live', expires_at: expiresAt },
      req
    });
    res.status(201).json({
      success: true,
      key_id: r.insertId,
      key,
      mode: org.sandbox_flag ? 'sandbox' : 'live',
      expires_at: expiresAt,
      secret_notice: 'Store this key now. It is never returned in full again.'
    });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.get('/:id/api-keys', verifyToken, requireClient, async (req, res) => {
  try {
    const org = await requireOrgMember(req.user.id, req.params.id, ['owner']);
    const [rows] = await pool.execute(
      `SELECT id,key_prefix,active,mode,created_at,expires_at,revoked_at,rotated_at,last_used_at
         FROM organization_api_keys WHERE organization_id=? ORDER BY created_at DESC`,
      [org.id]
    );
    res.json({ success: true, keys: rows });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.post('/:id/api-keys/:keyId/rotate', verifyToken, requireClient, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const org = await requireOrgMember(req.user.id, req.params.id, ['owner']);
    const expiresAt = parseExpiry(req.body?.expires_in_days);
    const key = generateApiKey({ sandbox: Boolean(org.sandbox_flag) });
    await conn.beginTransaction();
    const [r] = await conn.execute(
      `UPDATE organization_api_keys
          SET active=FALSE, revoked_at=NOW(), rotated_at=NOW()
        WHERE id=? AND organization_id=? AND active=TRUE AND revoked_at IS NULL`,
      [req.params.keyId, org.id]
    );
    if (!r.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: 'Active API key not found' });
    }
    const [n] = await conn.execute(
      `INSERT INTO organization_api_keys
       (organization_id,key_prefix,key_hash,active,created_by,expires_at,mode)
       VALUES (?,?,?,?,?,?,?)`,
      [org.id, key.slice(0, 16), hashApiKey(key), 1, req.user.id, expiresAt, org.sandbox_flag ? 'sandbox' : 'live']
    );
    await conn.commit();
    await auditSecurity({
      actorId: req.user.id,
      action: 'api_key_rotated',
      targetType: 'organization_api_key',
      targetId: n.insertId,
      details: { organization_id: org.id, rotated_key_id: req.params.keyId },
      req
    });
    res.status(201).json({
      success: true,
      key_id: n.insertId,
      key,
      mode: org.sandbox_flag ? 'sandbox' : 'live',
      expires_at: expiresAt,
      secret_notice: 'Store this key now. It is never returned in full again.'
    });
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  } finally {
    conn.release();
  }
});

router.post('/:id/api-keys/:keyId/revoke', verifyToken, requireClient, async (req, res) => {
  try {
    const org = await requireOrgMember(req.user.id, req.params.id, ['owner']);
    const [result] = await pool.execute(
      `UPDATE organization_api_keys
          SET active=FALSE, revoked_at=NOW()
        WHERE id=? AND organization_id=? AND revoked_at IS NULL`,
      [req.params.keyId, org.id]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, error: 'API key not found' });
    await auditSecurity({
      actorId: req.user.id,
      action: 'api_key_revoked',
      targetType: 'organization_api_key',
      targetId: req.params.keyId,
      details: { organization_id: org.id },
      req
    });
    res.json({ success: true, message: 'API key revoked' });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.get('/admin/providers', verifyToken, requireAdmin, (req, res) => res.json({ success: true, providers: providerStatus() }));

router.post('/insurance/offer', verifyToken, requireClient, async (req, res) => {
  try {
    const result = await InsuranceProvider.offer({ userId: req.user.id, errandId: req.body?.errand_id || null });
    res.json({ success: true, provider: InsuranceProvider.mode, ...result });
  } catch (e) {
    res.status(502).json({ success: false, error: 'Insurance provider unavailable' });
  }
});

module.exports = router;
