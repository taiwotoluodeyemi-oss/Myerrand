const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/db.mysql');
const { verifyToken, requireClient } = require('../middleware/auth');
const { authenticateApiKey, requireOrgMember } = require('../services/enterprise');
const { PRIMARY_MARKET, MARKETS, WEBHOOK_MAX_PER_USER } = require('../config/marketplace');
const { calculateErrandPrice } = require('../utils/pricing');
const { encryptSecret, enqueueEvent, assertSafeWebhookUrl } = require('../services/eventOutbox');
const rateLimit = require('express-rate-limit');
const {
  MAX_PAYLOAD_BYTES, requestFingerprint, validateIdempotencyKey,
  parsePagination, rejectOversizedPayload
} = require('../services/merchantSecurity');
const { auditSecurity } = require('../services/securityAudit');
const { attachApiAudit } = require('../services/apiAudit');

const router = express.Router();

function safeError(error, fallback = 'Request failed') {
  if (error?.status) return error.message;
  return process.env.NODE_ENV === 'production' ? fallback : error?.message || fallback;
}

async function merchantAuth(req, res, next) {
  try {
    const apiKey = req.get('X-API-Key') || req.get('x-api-key');
    if (apiKey) {
      const auth = await authenticateApiKey(apiKey);
      if (!auth) return res.status(401).json({ success: false, error: 'Invalid, expired, revoked, or mode-incompatible API key' });
      req.user = { id: auth.userId, userType: 'client', role: auth.memberRole };
      req.org = auth;
      req.auth = {
        type: 'api_key',
        organizationId: auth.organizationId,
        userId: auth.userId,
        memberRole: auth.memberRole,
        apiKeyId: auth.api_key_id,
        mode: auth.mode
      };
      attachApiAudit(req, res);
      return next();
    }
    return verifyToken(req, res, () => {
      req.auth = { type: 'jwt', userId: req.user.id, mode: 'live' };
      attachApiAudit(req, res);
      return requireClient(req, res, next);
    });
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
}

const merchantRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.MERCHANT_RATE_LIMIT_PER_MINUTE || 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const apiKey = req.get('X-API-Key') || req.get('x-api-key');
    if (apiKey) return `api:${crypto.createHash('sha256').update(apiKey).digest('hex')}`;
    return `ip:${req.ip}`;
  },
  handler: (_req, res) => res.status(429).json({ success: false, error: 'Merchant API rate limit exceeded' })
});

router.use(rejectOversizedPayload);
router.use(merchantRateLimiter);
router.use(merchantAuth);

function requestedOrganizationId(req, body = req.body || {}) {
  if (req.auth?.type === 'api_key') {
    if (body.org_id != null && Number(body.org_id) !== Number(req.auth.organizationId)) {
      const e = new Error('API key is scoped to a different organization');
      e.status = 403;
      throw e;
    }
    return req.auth.organizationId;
  }
  return body.org_id != null ? Number(body.org_id) : null;
}

async function resolveOrganization(req, body = req.body || {}) {
  const orgId = requestedOrganizationId(req, body);
  if (!orgId) return null;
  if (req.auth?.type === 'api_key') return req.org;
  return requireOrgMember(req.user.id, orgId);
}

function assertModeMarket(req, org, requestedMarketId) {
  if (!org) return;
  const marketId = requestedMarketId || org.market_id || PRIMARY_MARKET.id;
  if (org.market_id && String(marketId) !== String(org.market_id)) {
    const e = new Error('Organization is not permitted to access this market');
    e.status = 403;
    throw e;
  }
  if (req.auth?.type === 'api_key' && req.auth.mode === 'sandbox' && !org.sandbox_flag) {
    const e = new Error('Sandbox API credentials cannot access live organization data');
    e.status = 403;
    throw e;
  }
}

async function createErrand(req, res) {
  const b = req.body || {};
  try {
    if (!b.title || !b.pickup_address || !b.delivery_address || !b.reference || !b.phone) {
      return res.status(400).json({ success: false, error: 'title, pickup_address, delivery_address, reference and phone are required' });
    }
    if (typeof b.title !== 'string' || b.title.length > 180 ||
        typeof b.pickup_address !== 'string' || b.pickup_address.length > 1000 ||
        typeof b.delivery_address !== 'string' || b.delivery_address.length > 1000 ||
        typeof b.reference !== 'string' || b.reference.length > 160 ||
        typeof b.phone !== 'string' || b.phone.length > 40) {
      return res.status(400).json({ success: false, error: 'One or more merchant fields exceed the allowed size' });
    }

    const org = await resolveOrganization(req, b);
    assertModeMarket(req, org, b.market_id);

    const requestedMarketId = org?.market_id || b.market_id || PRIMARY_MARKET.id;
    const selected = MARKETS.find(m => m.id === requestedMarketId);
    if (!selected) return res.status(400).json({ success: false, error: 'Unknown market' });
    if (selected.status === 'paused') return res.status(409).json({ success: false, error: 'Market is paused' });

    const marketId = selected.id;
    const zones = selected.zones;
    const requestedOrgId = org?.id || null;
    const zone = b.zone || zones[0];
    if (!zones.includes(zone)) return res.status(400).json({ success: false, error: 'Zone is not configured' });

    const key = validateIdempotencyKey(req.get('Idempotency-Key'));
    const fingerprint = key
      ? requestFingerprint({
          method: req.method,
          path: req.path,
          body: b,
          organizationId: requestedOrgId,
          mode: req.auth?.mode || 'live'
        })
      : null;

    const plat = b.pickup_latitude ?? b.pickup_lat ?? null;
    const plng = b.pickup_longitude ?? b.pickup_lng ?? null;
    const dlat = b.delivery_latitude ?? b.delivery_lat ?? null;
    const dlng = b.delivery_longitude ?? b.delivery_lng ?? null;

    const q = await calculateErrandPrice({
      pickup_lat: plat,
      pickup_lng: plng,
      delivery_latitude: dlat,
      delivery_lng: dlng,
      delivery_lat: dlat,
      delivery_lng: dlng,
      mode: b.mode || 'motorcycle',
      urgency: b.urgency || 'medium'
    });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      if (key) {
        const [[existing]] = await conn.execute(
          `SELECT response_json,status_code,request_hash
             FROM merchant_idempotency
            WHERE user_id=? AND idem_key=? FOR UPDATE`,
          [req.user.id, key]
        );
        if (existing) {
          if (existing.request_hash && existing.request_hash !== fingerprint) {
            await conn.rollback();
            return res.status(409).json({ success: false, error: 'Idempotency-Key was already used with a different request' });
          }
          await conn.commit();
          return res.status(Number(existing.status_code || 201)).json(JSON.parse(existing.response_json));
        }
      }

      const [r] = await conn.execute(
        `INSERT INTO errands
         (client_id,title,description,pickup_address,delivery_address,country,city,zone,market_id,
          channel,business_reference,contact_phone,pickup_latitude,pickup_longitude,
          delivery_latitude,delivery_longitude,amount,budget_amount,runner_payout,status,
          payment_status,org_id,po_number,cost_center)
         VALUES (?,?,?,?,?,?,?,?,?, 'business',?,?,?,?,?,?,?,?,?,?, 'pending',NULL,?,?,?)`,
        [
          req.user.id, b.title, b.description || null, b.pickup_address, b.delivery_address,
          selected.country || PRIMARY_MARKET.country, selected.city || selected.name || PRIMARY_MARKET.city,
          zone, marketId, b.reference, b.phone, plat, plng, dlat, dlng,
          q.client_total, q.client_total, q.runner_payout, requestedOrgId,
          b.po_number || null, b.cost_center || null
        ]
      );

      const out = {
        success: true,
        data: {
          errandId: r.insertId, market_id: marketId, zone, channel: 'business',
          reference: b.reference, org_id: requestedOrgId,
          po_number: b.po_number || null, cost_center: b.cost_center || null
        }
      };

      if (key) {
        await conn.execute(
          `INSERT INTO merchant_idempotency (user_id,idem_key,request_hash,response_json,status_code)
           VALUES (?,?,?,?,?)`,
          [req.user.id, key, fingerprint, JSON.stringify(out), 201]
        );
      }
      await conn.commit();

      await auditSecurity({
        actorId: req.user.id,
        action: 'merchant_errand_created',
        targetType: 'errand',
        targetId: r.insertId,
        details: {
          organization_id: requestedOrgId,
          auth_mode: req.auth?.type,
          api_key_id: req.auth?.apiKeyId || null,
          mode: req.auth?.mode || 'live',
          idempotent: Boolean(key)
        },
        req
      });

      return res.status(201).json(out);
    } catch (e) {
      try { await conn.rollback(); } catch (_) {}
      if (e.code === 'ER_DUP_ENTRY' && key) {
        const [[existing]] = await pool.execute(
          'SELECT response_json,status_code,request_hash FROM merchant_idempotency WHERE user_id=? AND idem_key=?',
          [req.user.id, key]
        );
        if (existing) {
          if (existing.request_hash && existing.request_hash !== fingerprint) {
            return res.status(409).json({ success: false, error: 'Idempotency-Key was already used with a different request' });
          }
          return res.status(Number(existing.status_code || 201)).json(JSON.parse(existing.response_json));
        }
      }
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    return res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
}

router.post('/errands', createErrand);

router.get('/errands', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const orgFilter = req.auth?.type === 'api_key' ? 'e.org_id=?' : '(e.client_id=? OR e.org_id IN (SELECT organization_id FROM organization_members WHERE user_id=?))';
    const params = req.auth?.type === 'api_key'
      ? [req.auth.organizationId, limit, offset]
      : [req.user.id, req.user.id, limit, offset];
    const [rows] = await pool.execute(
      `SELECT e.id,e.title,e.status,e.payment_status,e.channel,e.business_reference,e.contact_phone,
              e.country,e.city,e.zone,e.market_id,e.org_id,e.po_number,e.cost_center,
              e.paid_at,e.accepted_at,e.picked_up_at,e.delivered_at,e.completed_at,e.created_at
         FROM errands e
        WHERE ${orgFilter} AND e.channel='business'
        ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    res.json({ success: true, page, limit, count: rows.length, errands: rows });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.get('/errands/:id', async (req, res) => {
  try {
    const scope = req.auth?.type === 'api_key'
      ? ['e.org_id=?', [req.auth.organizationId]]
      : ['(e.client_id=? OR e.org_id IN (SELECT organization_id FROM organization_members WHERE user_id=?))', [req.user.id, req.user.id]];
    const [rows] = await pool.execute(
      `SELECT e.id,e.title,e.status,e.payment_status,e.channel,e.business_reference,e.contact_phone,
              e.country,e.city,e.zone,e.market_id,e.org_id,e.po_number,e.cost_center,
              e.paid_at,e.accepted_at,e.picked_up_at,e.delivered_at,e.completed_at,
              e.cancelled_at,e.disputed_at,e.created_at
         FROM errands e
        WHERE e.id=? AND e.channel='business' AND ${scope[0]}`,
      [req.params.id, ...scope[1]]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Errand not found' });
    res.json({ success: true, errand: rows[0] });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

async function resolveWebhookOrg(req, requestedOrgId) {
  if (req.auth?.type === 'api_key') {
    if (requestedOrgId != null && Number(requestedOrgId) !== Number(req.auth.organizationId)) {
      const e = new Error('API key is scoped to a different organization');
      e.status = 403;
      throw e;
    }
    return req.org;
  }
  if (requestedOrgId != null) return requireOrgMember(req.user.id, requestedOrgId);
  return null;
}

router.post('/webhooks', async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl || rawUrl.length > 2048) return res.status(400).json({ success: false, error: 'A valid webhook URL is required' });
    try { await assertSafeWebhookUrl(rawUrl); } catch (_) {
      return res.status(400).json({ success: false, error: 'Webhook URL is invalid or resolves to a private/local address' });
    }

    const org = await resolveWebhookOrg(req, req.body?.org_id);
    const organizationId = org?.id || null;
    const [[count]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM webhook_subscriptions
        WHERE active=TRUE AND ((organization_id=? AND ? IS NOT NULL) OR (organization_id IS NULL AND user_id=?))`,
      [organizationId, organizationId, req.user.id]
    );
    if (Number(count.n) >= WEBHOOK_MAX_PER_USER) {
      return res.status(409).json({ success: false, error: `Maximum ${WEBHOOK_MAX_PER_USER} active webhooks allowed` });
    }

    const secret = `me_${crypto.randomBytes(24).toString('hex')}`;
    const [result] = await pool.execute(
      'INSERT INTO webhook_subscriptions (user_id,organization_id,url,secret_ciphertext,active) VALUES (?,?,?,?,TRUE)',
      [req.user.id, organizationId, rawUrl, encryptSecret(secret)]
    );

    await auditSecurity({
      actorId: req.user.id,
      action: 'merchant_webhook_created',
      targetType: 'webhook_subscription',
      targetId: result.insertId,
      details: { organization_id: organizationId, auth_mode: req.auth?.type },
      req
    });

    res.status(201).json({
      success: true,
      webhook: { id: result.insertId, organization_id: organizationId, url: rawUrl, active: true },
      secret,
      secret_notice: 'Store this secret now. It is not returned by list endpoints.'
    });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.post('/webhooks/:id/rotate-secret', async (req, res) => {
  try {
    const org = await resolveWebhookOrg(req, req.body?.org_id);
    const organizationId = org?.id || null;
    if (organizationId && !['owner'].includes(org?.role || org?.memberRole)) {
      return res.status(403).json({ success: false, error: 'Organization owner permission is required to rotate webhook secrets' });
    }
    const where = organizationId ? 'organization_id=?' : 'organization_id IS NULL AND user_id=?';
    const [rows] = await pool.execute(
      `SELECT id FROM webhook_subscriptions WHERE id=? AND ${where} AND active=TRUE`,
      [req.params.id, ...(organizationId ? [organizationId] : [req.user.id])]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Active webhook not found' });
    const secret = `me_${crypto.randomBytes(24).toString('hex')}`;
    await pool.execute(
      `UPDATE webhook_subscriptions
       SET previous_secret_ciphertext=secret_ciphertext,
           previous_secret_expires_at=DATE_ADD(NOW(), INTERVAL 24 HOUR),
           secret_ciphertext=?, updated_at=NOW()
       WHERE id=?`,
      [encryptSecret(secret), req.params.id]
    );
    await auditSecurity({ actorId:req.user.id, action:'merchant_webhook_secret_rotated', targetType:'webhook_subscription', targetId:req.params.id, details:{organization_id:organizationId, grace_hours:24}, req });
    res.json({ success:true, webhook_id:Number(req.params.id), secret, secret_notice:'Store this secret now. The previous secret remains accepted for outbound signature verification for 24 hours.' });
  } catch(e) { res.status(e.status || 500).json({ success:false, error:safeError(e) }); }
});

router.get('/webhooks', async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const requestedOrgId = req.query.org_id != null ? Number(req.query.org_id) : null;
    const org = await resolveWebhookOrg(req, requestedOrgId);
    const organizationId = org?.id || null;
    const where = organizationId
      ? 'organization_id=?'
      : 'organization_id IS NULL AND user_id=?';
    const params = organizationId ? [organizationId, limit, offset] : [req.user.id, limit, offset];
    const [rows] = await pool.execute(
      `SELECT id,organization_id,url,active,last_status,last_error,attempts,created_at,updated_at
         FROM webhook_subscriptions WHERE ${where}
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params
    );
    res.json({ success: true, page, limit, count: rows.length, webhooks: rows });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.delete('/webhooks/:id', async (req, res) => {
  try {
    const org = await resolveWebhookOrg(req, req.query.org_id);
    const organizationId = org?.id || null;
    const where = organizationId ? 'organization_id=?' : 'organization_id IS NULL AND user_id=?';
    const [result] = await pool.execute(
      `UPDATE webhook_subscriptions SET active=FALSE,updated_at=NOW()
        WHERE id=? AND ${where}`,
      [req.params.id, ...(organizationId ? [organizationId] : [req.user.id])]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, error: 'Webhook not found' });
    res.json({ success: true, message: 'Webhook disabled' });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.post('/webhooks/:id/test', async (req, res) => {
  try {
    const org = await resolveWebhookOrg(req, req.body?.org_id);
    const organizationId = org?.id || null;
    const where = organizationId ? 'organization_id=?' : 'organization_id IS NULL AND user_id=?';
    const [rows] = await pool.execute(
      `SELECT id,url,active FROM webhook_subscriptions WHERE id=? AND ${where}`,
      [req.params.id, ...(organizationId ? [organizationId] : [req.user.id])]
    );
    if (!rows[0] || !rows[0].active) return res.status(404).json({ success: false, error: 'Active webhook not found' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const eventId = await enqueueEvent(conn, {
        eventType: 'test',
        payload: {
          type: 'test',
          test: true,
          organization_id: organizationId,
          user_id: req.user.id,
          sent_at: new Date().toISOString()
        },
        eventKey: `test:${organizationId || `user:${req.user.id}`}:${rows[0].id}:${Date.now()}`
      });
      await conn.commit();
      await pool.execute(
        'INSERT IGNORE INTO webhook_deliveries (outbox_id,subscription_id) VALUES (?,?)',
        [eventId, rows[0].id]
      );
      res.status(201).json({ success: true, event_id: eventId, message: 'Test webhook queued' });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: safeError(e) });
  }
});

router.get('/errands/:id/receipt', async (req, res) => {
  try {
    const scope = req.auth?.type === 'api_key'
      ? ['e.org_id=?', [req.auth.organizationId]]
      : ['(e.client_id=? OR e.org_id IN (SELECT organization_id FROM organization_members WHERE user_id=?))', [req.user.id, req.user.id]];
    const [rows] = await pool.execute(
      `SELECT e.id,e.title,e.status,e.business_reference,e.contact_phone,e.zone,e.market_id,e.org_id,
              e.po_number,e.cost_center,e.amount,m.default_currency receipt_currency,e.paid_at,
              e.accepted_at,e.picked_up_at,e.delivered_at,e.completed_at,o.name org_name
         FROM errands e
         LEFT JOIN organizations o ON o.id=e.org_id
         LEFT JOIN markets m ON m.id=e.market_id
        WHERE e.id=? AND e.channel='business' AND ${scope[0]}`,
      [req.params.id, ...scope[1]]
    );
    const e = rows[0];
    if (!e) return res.status(404).send('Errand not found');
    if (e.status !== 'completed') return res.status(409).send('Delivery receipt is available after completion');
    const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    res.type('html').send(
      `<!doctype html><html><head><meta charset="utf-8"><title>Delivery Receipt ${esc(e.id)}</title>` +
      `<style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:20px}` +
      `table{width:100%;border-collapse:collapse}td{padding:8px;border-bottom:1px solid #ddd}</style></head><body>` +
      `<h1>My Errand Delivery Receipt</h1><p>Completed business errand</p><table>` +
      `${[['Errand ID',e.id],['Business',e.org_name || 'Solo business client'],['Reference',e.business_reference],
        ['PO Number',e.po_number],['Cost Center',e.cost_center],['Zone',e.zone],['Status',e.status],
        ['Amount',e.amount],['Currency',e.receipt_currency],['Paid',e.paid_at],['Accepted',e.accepted_at],
        ['Picked up',e.picked_up_at],['Delivered',e.delivered_at],['Completed',e.completed_at]]
        .map(([k,v]) => `<tr><td><strong>${esc(k)}</strong></td><td>${esc(v || '—')}</td></tr>`).join('')}` +
      `</table><p>Generated by My Errand.</p></body></html>`
    );
  } catch (e) {
    res.status(500).send(process.env.NODE_ENV === 'production' ? 'Failed to generate receipt' : safeError(e));
  }
});

module.exports = router;
