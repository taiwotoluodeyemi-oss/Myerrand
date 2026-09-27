const crypto = require('crypto');
const { pool } = require('../config/db.mysql');
const { WEBHOOK_MAX_RETRIES, WEBHOOK_MAX_PER_USER, WEBHOOK_RETRY_BACKOFF_SECONDS } = require('../config/marketplace');
const { Notifier } = require('./notifier');
const dns = require('dns').promises;
const net = require('net');
const https = require('https');
const { recordWebhookFailure } = require('./observability');

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || p[0] === 0;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) {
      const mapped = v.slice(7);
      if (net.isIPv4(mapped)) return isPrivateIp(mapped);
    }
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  return false;
}

async function assertSafeWebhookUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { throw new Error('Webhook URL is invalid'); }
  const production = process.env.NODE_ENV === 'production';
  if (parsed.username || parsed.password) throw new Error('Webhook URL credentials are not allowed');
  if (parsed.protocol !== 'https:' && !( !production && ['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.protocol === 'http:')) {
    throw new Error('Webhook URL must use HTTPS');
  }
  if (parsed.port && !['443', '80'].includes(parsed.port)) throw new Error('Webhook URL port is not allowed');
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    if (!production) return parsed;
    throw new Error('Webhook host is not allowed');
  }
  if (isPrivateIp(host)) throw new Error('Webhook host is not allowed');
  const answers = await dns.lookup(host, { all: true, verbatim: true });
  if (!answers.length || answers.some(a => isPrivateIp(a.address))) throw new Error('Webhook host resolves to a private or local address');
  parsed.__validatedAddresses = answers.map(a => a.address);
  return parsed;
}

function webhookKeyMaterial() {
  return crypto.createHash('sha256').update(process.env.WEBHOOK_ENCRYPTION_KEY || process.env.JWT_SECRET || 'myerrand-stage5-dev-webhook-key').digest();
}

function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', webhookKeyMaterial(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

function decryptSecret(value) {
  const [ivB64, tagB64, dataB64] = String(value || '').split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Webhook secret is unavailable');
  const decipher = crypto.createDecipheriv('aes-256-gcm', webhookKeyMaterial(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

function signPayload(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function eventPayload(errand, eventType, extra = {}) {
  return {
    type: eventType,
    errand_id: errand?.id ?? extra.errand_id ?? null,
    status: errand?.status ?? extra.status ?? null,
    reference: errand?.business_reference ?? errand?.reference ?? null,
    market_id: errand?.market_id ?? null,
    zone: errand?.zone ?? null,
    client_id: errand?.client_id ?? null,
    runner_id: errand?.runner_id ?? null,
    timestamps: {
      paid_at: errand?.paid_at ?? null,
      accepted_at: errand?.accepted_at ?? null,
      picked_up_at: errand?.picked_up_at ?? null,
      delivered_at: errand?.delivered_at ?? null,
      completed_at: errand?.completed_at ?? null,
      cancelled_at: errand?.cancelled_at ?? null,
      disputed_at: errand?.disputed_at ?? null,
    },
    ...extra,
  };
}

async function enqueueEvent(conn, { eventType, errand, errandId = null, payload = null, eventKey = null }) {
  const id = errand?.id ?? errandId ?? null;
  const body = payload || eventPayload(errand, eventType);
  const key = eventKey || `${id || 'system'}:${eventType}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
  const [result] = await conn.execute(
    `INSERT INTO webhook_outbox (event_key, event_type, errand_id, payload_json)
     VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [key, eventType, id, JSON.stringify(body)]
  );
  return result.insertId;
}

async function enqueueEventAfterCommit(args) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await enqueueEvent(conn, args);
    await conn.commit();
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    throw error;
  } finally { conn.release(); }
}

async function recordNotificationFailure(eventId, eventType, userId, channel, error) {
  try {
    const message = String(error?.message || error || 'Notification failure').replace(/(secret|token|authorization|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').slice(0, 1000);
    await pool.execute(
      `INSERT INTO notification_failures
       (event_id,event_type,user_id,channel,error_code,error_message,attempts,last_seen_at)
       VALUES (?,?,?,?,?,?,1,NOW())`,
      [eventId || null, eventType || null, userId || null, channel || 'in_app', error?.code || null, message]
    );
  } catch (_) { /* observability must never affect the business transaction */ }
}

async function createNotificationFromEvent(eventId, event) {
  const p = event.payload || {};
  const targets = [];
  const add = (userId, title, message, type = 'info') => { if (userId) targets.push({ userId, title, message, type }); };
  const errandLabel = p.reference ? ` (${p.reference})` : (p.errand_id ? ` #${p.errand_id}` : '');
  switch (event.event_type) {
    case 'accepted': add(p.client_id, 'Runner accepted', `A runner accepted your errand${errandLabel}.`, 'success'); break;
    case 'delivered': add(p.client_id, 'Errand delivered', `Your errand${errandLabel} was marked delivered. Funds remain held during the release window.`, 'success'); break;
    case 'disputed':
      if (p.client_id && Number(p.client_id) !== Number(p.actor_id)) add(p.client_id, 'Errand disputed', `A dispute was opened for your errand${errandLabel}.`, 'warning');
      if (p.runner_id && Number(p.runner_id) !== Number(p.actor_id)) add(p.runner_id, 'Errand disputed', `A dispute was opened for errand${errandLabel}.`, 'warning');
      break;
    case 'resolved': add(p.client_id, 'Dispute resolved', `The dispute for errand${errandLabel} has been resolved.`, 'info'); add(p.runner_id, 'Dispute resolved', `The dispute for errand${errandLabel} has been resolved.`, 'info'); break;
    case 'release': add(p.runner_id, 'Funds released', `Runner earnings for errand${errandLabel} have been released.`, 'success'); break;
    case 'refund': add(p.client_id, 'Errand refunded', `Funds for errand${errandLabel} were returned to your spendable balance.`, 'success'); break;
    default: break;
  }
  for (const target of targets) {
    try {
      await pool.execute(
        `INSERT INTO notifications (user_id, errand_id, type, title, message, is_read, created_at, source_event_id)
         VALUES (?, ?, ?, ?, ?, FALSE, NOW(), ?) ON DUPLICATE KEY UPDATE id=id`,
        [target.userId, p.errand_id || null, target.type, target.title, target.message, eventId]
      );
    } catch (error) {
      await recordNotificationFailure(eventId, event.event_type, target.userId, 'in_app', error);
      continue;
    }
    if (event.event_type === 'disputed' || event.event_type === 'resolved') {
      try {
        const [[user]] = await pool.execute('SELECT phone,email FROM users WHERE id=? LIMIT 1', [target.userId]);
        if (user?.phone) await Notifier.sendSms({ to: user.phone, message: target.message });
        if (user?.email) await Notifier.sendEmail({ to: user.email, subject: target.title, text: target.message });
      } catch (notifyError) {
        // External notification delivery is best-effort and must never block in-app notifications.
        // Keep this marker explicit for operators/tests while the persisted error is sanitized.
        await recordNotificationFailure(eventId, event.event_type, target.userId, 'external', new Error(`optional notifier failed: ${notifyError?.message || 'unknown error'}`));
      }
    }
  }
  if (event.event_type === 'completed' && p.errand_id) {
    try {
      const { awardReferralForCompletedErrand } = require('./growthLedger');
      await awardReferralForCompletedErrand(p.errand_id);
    } catch (rewardError) {
      await recordNotificationFailure(eventId, event.event_type, null, 'referral', rewardError);
    }
  }
}

async function ensureDeliveries(outboxId) {
  const [[event]] = await pool.execute('SELECT * FROM webhook_outbox WHERE id = ?', [outboxId]);
  if (!event) return;
  const payload = JSON.parse(event.payload_json);
  const ownerId = payload.client_id || null;
  if (!ownerId) return;
  const [subs] = await pool.execute(
    `SELECT id FROM webhook_subscriptions WHERE active = TRUE AND user_id = ? ORDER BY id LIMIT ?`,
    [ownerId, WEBHOOK_MAX_PER_USER]
  );
  for (const sub of subs) await pool.execute('INSERT IGNORE INTO webhook_deliveries (outbox_id,subscription_id) VALUES (?,?)', [outboxId, sub.id]);
}

function safeWebhookError(error) {
  const code = error?.code ? ` (${error.code})` : '';
  const status = error?.response?.status ? ` HTTP ${error.response.status}` : '';
  return `Webhook delivery failed${status}${code}`;
}

async function claimDelivery(id) {
  const [result] = await pool.execute(
    `UPDATE webhook_deliveries
     SET status='processing', locked_at=NOW(), last_attempt_at=NOW(), updated_at=NOW()
     WHERE id=? AND (status='pending' OR status='retrying') AND next_attempt_at <= NOW()`,
    [id]
  );
  return result.affectedRows === 1;
}

async function deliverOne(delivery) {
  if (!(await claimDelivery(delivery.id))) return { skipped: true };
  const [[row]] = await pool.execute(
    `SELECT d.*, o.event_type, o.payload_json, s.url, s.secret_ciphertext,
            s.previous_secret_ciphertext, s.previous_secret_expires_at, s.user_id
     FROM webhook_deliveries d
     JOIN webhook_outbox o ON o.id=d.outbox_id
     JOIN webhook_subscriptions s ON s.id=d.subscription_id
     WHERE d.id=? AND s.active=TRUE`, [delivery.id]
  );
  if (!row) return { skipped: true };

  const payload = JSON.parse(row.payload_json);
  const body = JSON.stringify(payload);
  const eventId = row.outbox_id;
  try {
    const axios = require('axios');
    const headers = {
      'Content-Type': 'application/json',
      'X-MyErrand-Event': row.event_type,
      'X-MyErrand-Event-Id': String(eventId),
      'X-MyErrand-Signature': `sha256=${signPayload(decryptSecret(row.secret_ciphertext), body)}`,
    };
    if (row.previous_secret_ciphertext && row.previous_secret_expires_at && new Date(row.previous_secret_expires_at).getTime() > Date.now()) {
      headers['X-MyErrand-Signature-Previous'] = `sha256=${signPayload(decryptSecret(row.previous_secret_ciphertext), body)}`;
    }
    const safeUrl = await assertSafeWebhookUrl(row.url);
    const requestOptions = { timeout: 8000, maxRedirects: 0, headers, validateStatus: status => status >= 200 && status < 300 };
    if (safeUrl.protocol === 'https:' && Array.isArray(safeUrl.__validatedAddresses) && safeUrl.__validatedAddresses.length) {
      const address = safeUrl.__validatedAddresses[0];
      requestOptions.httpsAgent = new https.Agent({ keepAlive: false, lookup: (_hostname, _options, callback) => callback(null, address, net.isIPv6(address) ? 6 : 4) });
    }
    const response = await axios.post(row.url, body, requestOptions);
    await pool.execute(
      `UPDATE webhook_deliveries SET status='delivered', attempts=attempts+1, response_code=?, sent_at=NOW(), locked_at=NULL, last_error=NULL, updated_at=NOW() WHERE id=? AND status='processing'`,
      [response.status, row.id]
    );
    await pool.execute(`UPDATE webhook_subscriptions SET last_status='delivered', last_error=NULL, attempts=attempts+1, updated_at=NOW() WHERE id=?`, [row.subscription_id]);
    return { delivered: true };
  } catch (error) {
    recordWebhookFailure();
    const nextAttempts = Number(row.attempts) + 1;
    const dead = nextAttempts >= WEBHOOK_MAX_RETRIES;
    const backoff = WEBHOOK_RETRY_BACKOFF_SECONDS[Math.min(nextAttempts - 1, WEBHOOK_RETRY_BACKOFF_SECONDS.length - 1)] || 120;
    await pool.execute(
      `UPDATE webhook_deliveries
       SET status=?, attempts=?, next_attempt_at=DATE_ADD(NOW(), INTERVAL ? SECOND), last_error=?, response_code=?, locked_at=NULL, updated_at=NOW()
       WHERE id=? AND status='processing'`,
      [dead ? 'dead_letter' : 'retrying', nextAttempts, backoff, safeWebhookError(error), error.response?.status || null, row.id]
    );
    await pool.execute(
      `UPDATE webhook_subscriptions SET last_status=?, last_error=?, attempts=attempts+1, updated_at=NOW() WHERE id=?`,
      [dead ? 'dead_letter' : 'retrying', safeWebhookError(error), row.subscription_id]
    );
    return { delivered: false, deadLetter: dead };
  }
}

async function recoverStuckProcessing() {
  await pool.execute(
    `UPDATE webhook_deliveries SET status='retrying', locked_at=NULL, next_attempt_at=NOW(), updated_at=NOW()
     WHERE status='processing' AND locked_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)`,
  );
}

async function processWebhookOutbox({ limit = 50 } = {}) {
  await recoverStuckProcessing();
  const [events] = await pool.execute(`SELECT * FROM webhook_outbox WHERE processed_at IS NULL ORDER BY id ASC LIMIT ?`, [Number(limit)]);
  let notifications = 0;
  for (const event of events) {
    try { await createNotificationFromEvent(event.id, { event_type: event.event_type, payload: JSON.parse(event.payload_json) }); notifications++; }
    catch (error) { await recordNotificationFailure(event.id, event.event_type, null, 'in_app', error); }
    try {
      await ensureDeliveries(event.id);
      const [pending] = await pool.execute(
        `SELECT id FROM webhook_deliveries WHERE outbox_id=? AND status IN ('pending','retrying') AND next_attempt_at <= NOW() ORDER BY id`,
        [event.id]
      );
      for (const d of pending) await deliverOne(d);
      const [[open]] = await pool.execute(`SELECT COUNT(*) AS n FROM webhook_deliveries WHERE outbox_id=? AND status IN ('pending','processing','retrying')`, [event.id]);
      if (Number(open.n) === 0) await pool.execute('UPDATE webhook_outbox SET processed_at=NOW() WHERE id=?', [event.id]);
    } catch (error) { await recordNotificationFailure(event.id, event.event_type, null, 'webhook_worker', error); }
  }
  return { events: events.length, notifications };
}

async function processWebhookRetries({ limit = 50 } = {}) {
  await recoverStuckProcessing();
  const [rows] = await pool.execute(`SELECT id FROM webhook_deliveries WHERE status IN ('pending','retrying') AND next_attempt_at <= NOW() ORDER BY id LIMIT ?`, [Number(limit)]);
  let delivered = 0;
  for (const row of rows) { const result = await deliverOne(row); if (result.delivered) delivered++; }
  return { attempted: rows.length, delivered };
}

async function replayDeadLetter(deliveryId) {
  const [result] = await pool.execute(
    `UPDATE webhook_deliveries SET status='retrying', attempts=0, next_attempt_at=NOW(), locked_at=NULL, last_error=NULL, updated_at=NOW()
     WHERE id=? AND status='dead_letter'`, [deliveryId]
  );
  if (!result.affectedRows) return false;
  await pool.execute(`UPDATE webhook_outbox o JOIN webhook_deliveries d ON d.outbox_id=o.id SET o.processed_at=NULL WHERE d.id=?`, [deliveryId]);
  return true;
}

module.exports = {
  assertSafeWebhookUrl, encryptSecret, decryptSecret, signPayload, enqueueEvent, enqueueEventAfterCommit,
  processWebhookOutbox, processWebhookRetries, createNotificationFromEvent, replayDeadLetter, recoverStuckProcessing,
};
