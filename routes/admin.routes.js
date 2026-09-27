const express = require('express');
const { pool } = require('../config/db.mysql');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const { auditSecurity } = require('../services/securityAudit');
const { creditUser, debitUser } = require('../services/financialService');

router.use(verifyToken, requireAdmin);

/** List recent wallet / payment-style transactions */
router.post('/promos', async (req,res)=>{
  try { const {code,credit_type='fixed',credit_value,max_redemptions=1,expires_at=null}=req.body||{}; if(!code||!['fixed','percent'].includes(credit_type)||!(Number(credit_value)>0)) return res.status(400).json({success:false,error:'code, credit_type and positive credit_value required'}); const [r]=await pool.execute('INSERT INTO promo_codes (code,credit_type,credit_value,max_redemptions,expires_at) VALUES (?,?,?,?,?)',[String(code).trim().toUpperCase(),credit_type,credit_value,max_redemptions,expires_at]); res.status(201).json({success:true,id:r.insertId}); } catch(e){res.status(500).json({success:false,error:e.message});}
});

router.get('/promos', async (req,res)=>{ try { const [rows]=await pool.execute(`SELECT p.*,COUNT(r.id) redemptions FROM promo_codes p LEFT JOIN promo_redemptions r ON r.promo_id=p.id GROUP BY p.id ORDER BY p.created_at DESC`); res.json({success:true,promos:rows}); } catch(e){res.status(500).json({success:false,error:e.message});} });

router.get('/payments', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT wt.*, 
              u.name AS user_name, u.email AS user_email,
              e.title AS errand_title
       FROM wallet_transactions wt
       LEFT JOIN wallets w ON w.id = COALESCE(wt.to_wallet_id, wt.from_wallet_id)
       LEFT JOIN users u ON u.id = w.user_id
       LEFT JOIN errands e ON e.id = wt.errand_id
       ORDER BY wt.created_at DESC
       LIMIT 200`
    );
    res.json({ success: true, payments: rows });
  } catch (err) {
    console.error('admin/payments', err);
    res.status(500).json({ error: 'Failed to load payments', detail: err.message });
  }
});

/** List users */
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, email, phone, user_type, status, balance, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT 500`
    );
    res.json({ success: true, users: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** List errands */
router.get('/errands', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.*, c.name AS client_name, r.name AS runner_name
       FROM errands e
       LEFT JOIN users c ON c.id = e.client_id
       LEFT JOIN users r ON r.id = e.runner_id
       ORDER BY e.created_at DESC
       LIMIT 200`
    );
    res.json({ success: true, errands: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Stage 3: multi-zone operator control, rollup and expansion gates. */
const {
  PRIMARY_MARKET, SUPPLY_GATE_RUNNERS, MIN_SAMPLE_JOBS, ZONE_HEALTH,
  MAX_ACTIVE_LAUNCH_ZONES, EXPAND_AFTER_HEALTHY_WEEKS,
} = require('../config/marketplace');
const { median, buildMetrics, rollupMetricSets } = require('../services/zoneScoreboard');
const { JOB_EXPIRE_HOURS, ESCROW_RELEASE_HOURS, MAX_HOLD_AGE_HOURS } = require('../config/marketplace');
const { processWebhookOutbox } = require('../services/eventOutbox');
const { processDueReleases, processDueRefunds } = require('../services/errandMoney');

async function zoneMetrics(zone, days = 7) {
  const safeDays = Number(days) === 30 ? 30 : 7;
  const [[counts]] = await pool.execute(
    `SELECT COUNT(*) AS jobs_created,
       SUM(CASE WHEN e.payment_status IN ('paid','escrowed','released','refunded') OR e.paid_at IS NOT NULL THEN 1 ELSE 0 END) AS jobs_paid,
       SUM(CASE WHEN e.accepted_at IS NOT NULL OR e.status IN ('accepted','picked_up','delivered','completed','cancelled','disputed') THEN 1 ELSE 0 END) AS jobs_accepted,
       SUM(CASE WHEN e.completed_at IS NOT NULL OR e.status = 'completed' THEN 1 ELSE 0 END) AS jobs_completed,
       SUM(CASE WHEN e.status = 'cancelled' THEN 1 ELSE 0 END) AS jobs_cancelled
     FROM errands e WHERE e.zone = ? AND e.created_at >= DATE_SUB(NOW(), INTERVAL ${safeDays} DAY)`, [zone]);
  const [[disputeRow]] = await pool.execute(
    `SELECT COUNT(DISTINCT d.errand_id) AS disputed_jobs FROM errand_disputes d JOIN errands e ON e.id=d.errand_id
     WHERE e.zone = ? AND d.created_at >= DATE_SUB(NOW(), INTERVAL ${safeDays} DAY)`, [zone]);
  const [acceptRows] = await pool.execute(
    `SELECT TIMESTAMPDIFF(SECOND, e.paid_at, e.accepted_at) / 60 AS minutes FROM errands e
     WHERE e.zone = ? AND e.created_at >= DATE_SUB(NOW(), INTERVAL ${safeDays} DAY) AND e.paid_at IS NOT NULL AND e.accepted_at IS NOT NULL`, [zone]);
  return buildMetrics({ days: safeDays, counts, disputedJobs: Number(disputeRow.disputed_jobs || 0), acceptMinutes: acceptRows.map(r => Number(r.minutes)) });
}

async function supplyForZone(zone) {
  const [rows] = await pool.execute(
    `SELECT r.user_id, u.name, u.email, u.phone, r.vehicle_type, r.service_zones, r.areas_of_service,
            r.available_hours, r.emergency_contact_name, r.emergency_contact_phone, r.background_check_status,
            r.is_available, r.last_active,
            (r.vehicle_type IS NOT NULL AND r.vehicle_type <> 'none') AS has_vehicle,
            (COALESCE(r.service_zones, r.areas_of_service) IS NOT NULL AND TRIM(COALESCE(r.service_zones, r.areas_of_service)) <> '') AS has_zone,
            (r.available_hours IS NOT NULL AND TRIM(r.available_hours) <> '') AS has_hours,
            (r.emergency_contact_name IS NOT NULL AND TRIM(r.emergency_contact_name) <> '' AND r.emergency_contact_phone IS NOT NULL AND TRIM(r.emergency_contact_phone) <> '') AS has_emergency
     FROM runners r JOIN users u ON u.id = r.user_id
     WHERE CONCAT(',', REPLACE(COALESCE(r.service_zones, r.areas_of_service, ''), ' ', ''), ',') LIKE CONCAT('%,', REPLACE(?, ' ', ''), ',%')
     ORDER BY u.name`, [zone]);
  const runners = rows.map(r => { const c = ['has_vehicle','has_zone','has_hours','has_emergency'].filter(k => Number(r[k]) === 1).length; return { ...r, profile_completeness: c / 4, launch_ready: c === 4 }; });
  return { launch_ready_count: runners.filter(r => r.launch_ready).length, runners };
}

router.get('/zones', async (req, res) => {
  try {
    const [configured] = await pool.execute(`SELECT zone, city, country, launch_focus, pause_demand FROM market_zones WHERE country = ? AND city = ? ORDER BY zone`, [PRIMARY_MARKET.country, PRIMARY_MARKET.city]);
    const source = configured.length ? configured : PRIMARY_MARKET.zones.map(zone => ({ zone, city: PRIMARY_MARKET.city, country: PRIMARY_MARKET.country, launch_focus: 0, pause_demand: 0 }));
    const zones = [];
    for (const z of source) {
      const [metrics7, metrics30, supply] = await Promise.all([zoneMetrics(z.zone, 7), zoneMetrics(z.zone, 30), supplyForZone(z.zone)]);
      zones.push({ ...z, launch_focus: !!z.launch_focus, pause_demand: !!z.pause_demand, health: metrics30.color, metrics_7d: metrics7, metrics_30d: metrics30, ready_runners: supply.launch_ready_count });
    }
    const activeLaunchZones = zones.filter(z => z.launch_focus && !z.pause_demand).length;
    res.json({ success: true, market: PRIMARY_MARKET, supply_gate_runners: SUPPLY_GATE_RUNNERS, max_active_launch_zones: MAX_ACTIVE_LAUNCH_ZONES,
      active_launch_zones: activeLaunchZones, active_launch_zone_warning: activeLaunchZones > MAX_ACTIVE_LAUNCH_ZONES, zones });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/zones/:zone/flags', async (req, res) => {
  try {
    const zone = req.params.zone;
    if (!PRIMARY_MARKET.zones.includes(zone)) return res.status(404).json({ error: 'Zone is not configured' });
    const launchFocus = req.body.launch_focus;
    const pauseDemand = req.body.pause_demand;
    const [currentRows] = await pool.execute(`SELECT launch_focus, pause_demand FROM market_zones WHERE country=? AND city=? AND zone=?`, [PRIMARY_MARKET.country, PRIMARY_MARKET.city, zone]);
    const current = currentRows[0] || { launch_focus: 0, pause_demand: 0 };
    const nextLaunch = launchFocus === undefined ? !!current.launch_focus : !!launchFocus;
    const nextPause = pauseDemand === undefined ? !!current.pause_demand : !!pauseDemand;
    if (nextLaunch && !current.launch_focus) {
      const [[count]] = await pool.execute(`SELECT COUNT(*) AS n FROM market_zones WHERE country=? AND city=? AND launch_focus=1 AND pause_demand=0`, [PRIMARY_MARKET.country, PRIMARY_MARKET.city]);
      if (Number(count.n) >= MAX_ACTIVE_LAUNCH_ZONES) return res.status(409).json({ error: `Maximum active launch zones (${MAX_ACTIVE_LAUNCH_ZONES}) reached` });
    }
    await pool.execute(`INSERT INTO market_zones (country,city,zone,launch_focus,pause_demand) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE launch_focus=VALUES(launch_focus), pause_demand=VALUES(pause_demand)`, [PRIMARY_MARKET.country, PRIMARY_MARKET.city, zone, nextLaunch ? 1 : 0, nextPause ? 1 : 0]);
    res.json({ success: true, zone, launch_focus: nextLaunch, pause_demand: nextPause });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/zones/:zone/supply', async (req, res) => {
  try { const supply = await supplyForZone(req.params.zone); res.json({ success: true, zone: req.params.zone, supply_gate_runners: SUPPLY_GATE_RUNNERS, ...supply }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/zones/:zone/scoreboard', async (req, res) => {
  try { const days = Number(req.query.days) === 30 ? 30 : 7; const metrics = await zoneMetrics(req.params.zone, days); res.json({ success: true, zone: req.params.zone, metrics, thresholds: ZONE_HEALTH, min_sample_jobs: MIN_SAMPLE_JOBS }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/city-scoreboard', async (req, res) => {
  try {
    const days = Number(req.query.days) === 30 ? 30 : 7;
    const zones = PRIMARY_MARKET.zones;
    const metrics = [];
    for (const zone of zones) metrics.push({ zone, metrics: await zoneMetrics(zone, days) });
    res.json({ success: true, city: PRIMARY_MARKET.city, days, metrics, rollup: rollupMetricSets(metrics.map(x => x.metrics), days), thresholds: ZONE_HEALTH, min_sample_jobs: MIN_SAMPLE_JOBS });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/expansion/checklist', async (req, res) => {
  try {
    const sourceZone = req.query.source_zone || '';
    const targetZone = req.query.target_zone || '';
    const source = sourceZone ? await zoneMetrics(sourceZone, 30) : null;
    const targetConfigured = PRIMARY_MARKET.zones.includes(targetZone);
    const targetSupply = targetConfigured ? await supplyForZone(targetZone) : { launch_ready_count: 0 };
    const sourceHealthy = !!source && source.color === 'GREEN';
    const supplyReady = targetSupply.launch_ready_count >= SUPPLY_GATE_RUNNERS;
    const allowed = sourceHealthy && targetConfigured && supplyReady;
    res.json({ success: true, source_zone: sourceZone, target_zone: targetZone,
      checklist: { source_healthy: sourceHealthy, target_in_config: targetConfigured, target_ready_runners: targetSupply.launch_ready_count, supply_gate: SUPPLY_GATE_RUNNERS, runners_gate_met: supplyReady, allowed },
      source_metrics_30d: source, expansion_after_healthy_weeks: EXPAND_AFTER_HEALTHY_WEEKS });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/expansion-events', async (req, res) => {
  try {
    const { from_zone, to_zone, operator_note } = req.body || {};
    if (!from_zone || !to_zone || from_zone === to_zone) return res.status(400).json({ error: 'from_zone and a different to_zone are required' });
    const source = await zoneMetrics(from_zone, 30);
    const targetConfigured = PRIMARY_MARKET.zones.includes(to_zone);
    const targetSupply = targetConfigured ? await supplyForZone(to_zone) : { launch_ready_count: 0 };
    if (source.color !== 'GREEN' || !targetConfigured || targetSupply.launch_ready_count < SUPPLY_GATE_RUNNERS) return res.status(409).json({ error: 'Expansion gate not met', checklist: { source_healthy: source.color === 'GREEN', target_in_config: targetConfigured, target_ready_runners: targetSupply.launch_ready_count, supply_gate: SUPPLY_GATE_RUNNERS } });
    const [result] = await pool.execute(`INSERT INTO expansion_events (from_zone,to_zone,city,operator_id,operator_note) VALUES (?,?,?,?,?)`, [from_zone, to_zone, PRIMARY_MARKET.city, req.user.id, operator_note || null]);
    res.status(201).json({ success: true, id: result.insertId, from_zone, to_zone });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/expansion-events', async (req, res) => {
  try { const [rows] = await pool.execute(`SELECT * FROM expansion_events WHERE city=? ORDER BY created_at DESC LIMIT 100`, [PRIMARY_MARKET.city]); res.json({ success: true, events: rows }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Stage 5 operations queue. Read-only lists plus safe actions that delegate to the existing money engine.
router.get('/observability', async (req, res) => {
  try {
    const { operationalSnapshot } = require('../services/observability');
    const snapshot = await operationalSnapshot();
    res.status(snapshot.healthy ? 200 : 503).json({ success: snapshot.healthy, observability: snapshot });
  } catch (err) { res.status(503).json({ success: false, error: 'Observability unavailable' }); }
});

router.get('/operations-center', async (req, res) => {
  try {
    const { listOperations } = require('../services/adminOperations');
    const data = await listOperations(req.query);
    res.json({ success: true, operations_center: data });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Operations Center unavailable' });
  }
});

router.post('/operations-center/action', async (req, res) => {
  try {
    const { action } = req.body || {};
    const { auditSecurity } = require('../services/securityAudit');
    let result;
    if (action === 'process_due_money') {
      const refunds = await processDueRefunds();
      const releases = await processDueReleases();
      result = { refunds, releases };
    } else if (action === 'process_webhooks') {
      result = await processWebhookOutbox({ limit: 100 });
    } else if (action === 'replay_webhook') {
      const { replayDeadLetter } = require('../services/eventOutbox');
      if (!req.body.id) return res.status(400).json({ success:false, error:'id required' });
      const ok = await replayDeadLetter(req.body.id);
      if (!ok) return res.status(404).json({ success:false, error:'Dead-letter webhook delivery not found' });
      result = { replay_queued: true, id: req.body.id };
    } else {
      return res.status(400).json({ success:false, error:'Unsupported operations action' });
    }
    await auditSecurity({ actorId:req.user.id, action:`operations_${action}`, targetType:'operations_center', targetId:req.body.id || null, details:{ action }, req });
    res.json({ success:true, result });
  } catch (err) {
    res.status(err.status || 500).json({ success:false, error:'Operations action failed' });
  }
});

router.get('/ops', async (req, res) => {
  try {
    const nearExpiryHours = Math.max(1, JOB_EXPIRE_HOURS - 6);
    const [openDisputes] = await pool.execute(`SELECT d.id,d.errand_id,d.reason_code,d.note,d.created_at,e.title,e.status,e.client_id,e.runner_id FROM errand_disputes d JOIN errands e ON e.id=d.errand_id WHERE d.status='open' ORDER BY d.created_at ASC LIMIT 100`);
    const [stuckHolds] = await pool.execute(`SELECT h.id,h.errand_id,h.amount,h.currency,h.held_at,e.status,e.title,e.client_id,e.runner_id FROM errand_holds h JOIN errands e ON e.id=h.errand_id WHERE h.status='held' AND h.held_at <= DATE_SUB(NOW(), INTERVAL ? HOUR) ORDER BY h.held_at ASC LIMIT 100`, [MAX_HOLD_AGE_HOURS]);
    const [dueReleases] = await pool.execute(`SELECT h.id,h.errand_id,h.amount,h.currency,e.status,e.delivered_at,e.title FROM errand_holds h JOIN errands e ON e.id=h.errand_id WHERE h.status='held' AND e.status IN ('delivered','completed') AND e.delivered_at IS NOT NULL AND e.delivered_at <= DATE_SUB(NOW(), INTERVAL ? HOUR) AND NOT EXISTS (SELECT 1 FROM errand_disputes d WHERE d.errand_id=e.id AND d.status='open') ORDER BY e.delivered_at ASC LIMIT 100`, [ESCROW_RELEASE_HOURS]);
    const [nearingExpiry] = await pool.execute(`SELECT h.id,h.errand_id,h.amount,h.currency,e.status,e.paid_at,e.title,e.client_id FROM errand_holds h JOIN errands e ON e.id=h.errand_id WHERE h.status='held' AND e.status='paid' AND e.runner_id IS NULL AND e.paid_at IS NOT NULL AND e.paid_at <= DATE_SUB(NOW(), INTERVAL ? HOUR) ORDER BY e.paid_at ASC LIMIT 100`, [nearExpiryHours]);
    const [deadLetters] = await pool.execute(`SELECT d.id,d.outbox_id,d.subscription_id,d.status,d.attempts,d.last_error,d.response_code,d.created_at,s.url,s.user_id FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE d.status='dead_letter' ORDER BY d.created_at DESC LIMIT 100`);
    const [notificationFailures] = await pool.execute(`SELECT id,event_id,event_type,user_id,channel,error_code,error_message,attempts,created_at,last_seen_at FROM notification_failures ORDER BY created_at DESC LIMIT 100`);
    res.json({ success: true, queues: { open_disputes: openDisputes, stuck_holds: stuckHolds, due_releases: dueReleases, paid_unaccepted_near_expiry: nearingExpiry, webhook_dead_letters: deadLetters, notification_failures: notificationFailures }, thresholds: { job_expire_hours: JOB_EXPIRE_HOURS, escrow_release_hours: ESCROW_RELEASE_HOURS, max_hold_age_hours: MAX_HOLD_AGE_HOURS } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ops/process-due-money', async (req, res) => {
  try {
    const refunds = await processDueRefunds();
    const releases = await processDueReleases();
    res.json({ success: true, refunds, releases });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ops/process-webhooks', async (req, res) => {
  try {
    const result = await processWebhookOutbox({ limit: 100 });
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ops/webhook-dead-letter/:id/retry', async (req, res) => {
  try {
    const { replayDeadLetter } = require('../services/eventOutbox');
    const ok = await replayDeadLetter(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Dead-letter webhook delivery not found' });
    res.json({ success: true, message: 'Webhook delivery replay queued' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** Suspend / activate user */
router.patch('/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await pool.execute('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: 'User status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ========== Gift card commerce (admin) ==========
const { encryptCode, audit } = require('./giftcards.routes');
const { notifyUser } = require('../utils/notify');

router.get('/gift-card-products', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM gift_card_products ORDER BY brand, denomination`
    );
    res.json({ success: true, products: rows });
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  }
});

router.post('/gift-card-products', async (req, res) => {
  try {
    const {
      brand, product_name, denomination, face_currency = 'USD', region = 'United States',
      selling_price_ngn, supplier_cost_ngn, description, image_url, status = 'active'
    } = req.body || {};
    if (!brand || !product_name || !denomination || !selling_price_ngn) {
      return res.status(400).json({ error: 'brand, product_name, denomination, selling_price_ngn required' });
    }
    const [r] = await pool.execute(
      `INSERT INTO gift_card_products
        (brand, product_name, denomination, face_currency, region, selling_price_ngn, supplier_cost_ngn, description, image_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [brand, product_name, denomination, face_currency, region, selling_price_ngn,
        supplier_cost_ngn || null, description || null, image_url || null, status]
    );
    await audit(req.user.id, 'gift_product_create', 'gift_card_product', r.insertId, selling_price_ngn, { brand, product_name }, req.ip);
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  }
});

router.patch('/gift-card-products/:id', async (req, res) => {
  try {
    const fields = ['brand', 'product_name', 'denomination', 'face_currency', 'region',
      'selling_price_ngn', 'supplier_cost_ngn', 'description', 'image_url', 'status'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id);
    await pool.execute(`UPDATE gift_card_products SET ${sets.join(', ')} WHERE id = ?`, vals);
    await audit(req.user.id, 'gift_product_update', 'gift_card_product', Number(req.params.id), req.body.selling_price_ngn || null, req.body, req.ip);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  }
});

router.get('/gift-card-orders', async (req, res) => {
  try {
    const status = req.query.status;
    let sql = `SELECT o.*, u.name AS customer_name, u.email AS customer_email
               FROM gift_card_orders o
               LEFT JOIN users u ON u.id = o.user_id`;
    const params = [];
    if (status) {
      sql += ' WHERE o.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY o.created_at DESC LIMIT 200';
    const [rows] = await pool.execute(sql, params);
    // strip encrypted codes from list
    const safe = rows.map(({ gift_code_encrypted, ...rest }) => rest);
    res.json({ success: true, orders: safe });
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  }
});

router.post('/gift-card-orders/:id/fulfill', async (req, res) => {
  const { code, notes } = req.body || {};
  if (!code || String(code).trim().length < 4) {
    return res.status(400).json({ error: 'Valid gift card code required' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT * FROM gift_card_orders WHERE id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Order not found' });
    }
    const order = rows[0];
    if (order.status === 'fulfilled') {
      await connection.rollback();
      return res.status(400).json({ error: 'Order already fulfilled' });
    }
    if (order.status === 'refunded' || order.status === 'cancelled') {
      await connection.rollback();
      return res.status(400).json({ error: 'Cannot fulfill cancelled/refunded order' });
    }
    const enc = encryptCode(String(code).trim());
    await connection.execute(
      `UPDATE gift_card_orders
       SET status = 'fulfilled', gift_code_encrypted = ?, fulfilled_by = ?, fulfilled_at = NOW(),
           fulfillment_notes = ?
       WHERE id = ?`,
      [enc, req.user.id, notes || null, order.id]
    );
    await connection.commit();
    await audit(req.user.id, 'gift_order_fulfill', 'gift_card_order', order.id, order.price_ngn, { order_ref: order.order_ref }, req.ip);
    notifyUser({
      userId: order.user_id,
      title: 'Gift card ready',
      message: `Your order ${order.order_ref} has been fulfilled. Log in to view your code.`,
      type: 'success'
    }).catch(() => {});
    res.json({ success: true, message: 'Order fulfilled' });
  } catch (e) {
    await connection.rollback();
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  } finally {
    connection.release();
  }
});

router.get('/gift-card-stats', async (req, res) => {
  try {
    const [[sales]] = await pool.execute(
      `SELECT COALESCE(SUM(price_ngn),0) AS total_sales, COUNT(*) AS order_count
       FROM gift_card_orders WHERE status IN ('pending_fulfillment','fulfilled','under_review')`
    );
    const [[pending]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM gift_card_orders WHERE status = 'pending_fulfillment'`
    );
    const [[fulfilled]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM gift_card_orders WHERE status = 'fulfilled'`
    );
    res.json({
      success: true,
      total_sales_ngn: parseFloat(sales.total_sales),
      order_count: sales.order_count,
      pending_fulfillment: pending.n,
      fulfilled: fulfilled.n
    });
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  }
});



// Platform settings (deposit limits, hold hours)
router.get('/settings', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT setting_key, setting_value FROM platform_settings');
    const settings = {};
    rows.forEach((r) => { settings[r.setting_key] = r.setting_value; });
    res.json({ success: true, settings });
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const allowed = ['min_deposit_ngn', 'max_deposit_ngn', 'large_deposit_review_ngn', 'hold_hours_large_deposit'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        await pool.execute(
          `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [key, String(req.body[key])]
        );
      }
    }
    const { audit } = require('./giftcards.routes');
    await audit(req.user.id, 'settings_update', 'platform_settings', null, null, req.body, req.ip);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  }
});

/** Manual wallet credit/debit with mandatory reason + audit */
router.post('/wallet-adjust', async (req, res) => {
  const { userId, amount, reason, direction } = req.body || {};
  const amt = Number(amount);
  if (!Number.isInteger(Number(userId)) || !Number.isFinite(amt) || amt <= 0 || !reason || String(reason).trim().length < 5) return res.status(400).json({ error: 'userId, positive amount, and reason (min 5 chars) required' });
  if (!['credit','debit'].includes(direction)) return res.status(400).json({ error: 'direction must be credit or debit' });
  try {
    const result = direction === 'credit'
      ? await creditUser({userId:Number(userId),walletType:'spendable',currency:'NGN',amount:amt,transactionType:'manual_credit',description:`Admin adjust: ${reason}`,actorId:req.user.id,reason:String(reason).trim()})
      : await debitUser({userId:Number(userId),walletType:'spendable',currency:'NGN',amount:amt,transactionType:'manual_debit',description:`Admin adjust: ${reason}`,actorId:req.user.id,reason:String(reason).trim()});
    await auditSecurity({actorId:req.user.id,action:'wallet_adjust',targetType:'user',targetId:Number(userId),details:{direction,amount:amt,reason:String(reason).trim()},req});
    res.json({success:true,message:`Wallet ${direction} applied`,result});
  } catch (e) { res.status(e.status||500).json({error:e.status?e.message:'Wallet adjustment failed'}); }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ success: true, logs: rows });
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  }
});




// Stage 7 trust analytics: read-only derived metrics; no fake values below sample threshold.
router.get('/trust/funnel', async (req,res)=>{
  try {
    const marketId = req.query.market_id || null;
    const where = marketId ? 'WHERE market_id=?' : '';
    const params = marketId ? [marketId] : [];
    const [[created]] = await pool.execute(`SELECT COUNT(*) n FROM errands ${where}`,params);
    const [[paid]] = await pool.execute(`SELECT COUNT(*) n FROM errands ${where} ${marketId?'AND':'WHERE'} paid_at IS NOT NULL`,params);
    const [[accepted]] = await pool.execute(`SELECT COUNT(*) n FROM errands ${where} ${marketId?'AND':'WHERE'} accepted_at IS NOT NULL`,params);
    const [[completed]] = await pool.execute(`SELECT COUNT(*) n FROM errands ${where} ${marketId?'AND':'WHERE'} completed_at IS NOT NULL`,params);
    const [[disputeCount]] = await pool.execute(`SELECT COUNT(DISTINCT d.errand_id) n FROM errand_disputes d JOIN errands e ON e.id=d.errand_id ${marketId?'WHERE e.market_id=?':'WHERE 1=1'}`,marketId?[marketId]:[]);
    const [[verification]] = await pool.execute(`SELECT COUNT(*) registered, SUM(id_document_path IS NOT NULL) submitted, SUM(verification_status='approved') approved FROM runners`);
    const [reasons] = await pool.execute(`SELECT reason_code,COUNT(*) count FROM errand_disputes GROUP BY reason_code ORDER BY count DESC`);
    const createdN=Number(created.n||0),paidN=Number(paid.n||0),acceptedN=Number(accepted.n||0),completedN=Number(completed.n||0);
    res.json({success:true,funnel:{created:createdN,paid:paidN,accepted:acceptedN,completed:completedN,conversion:{created_to_paid:createdN?paidN/createdN:null,paid_to_accepted:paidN?acceptedN/paidN:null,accepted_to_completed:acceptedN?completedN/acceptedN:null}},disputes:{count:Number(disputeCount.n||0),by_reason:reasons},verification_funnel:{registered_runners:Number(verification.registered||0),submitted:Number(verification.submitted||0),approved:Number(verification.approved||0)}});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

router.get('/trust/export', async (req,res)=>{
  try {
    const marketId=req.query.market_id||null;
    const params=[];
    let sql=`SELECT e.id,e.status,e.payment_status,e.market_id,e.zone,e.channel,e.created_at,e.paid_at,e.accepted_at,e.picked_up_at,e.delivered_at,e.completed_at,e.cancelled_at,e.disputed_at,e.client_id,e.runner_id FROM errands e`;
    if(marketId){sql+=' WHERE e.market_id=?';params.push(marketId);}
    sql+=' ORDER BY e.created_at DESC';
    const [rows]=await pool.execute(sql,params);
    const esc=(v)=>`"${String(v??'').replace(/"/g,'""')}"`;
    // Privacy-safe operational export: deliberately excludes client/runner names, emails, phones, addresses and IDs.
    const header=['id','status','payment_status','market_id','zone','channel','created_at','paid_at','accepted_at','picked_up_at','delivered_at','completed_at','cancelled_at','disputed_at'];
    const csv=[header.join(','),...rows.map(r=>header.map(k=>esc(r[k])).join(','))].join('\n')+'\n';
    await auditSecurity({actorId:req.user.id,action:'privacy_safe_export',targetType:'errands',targetId:null,details:{market_id:marketId,rows:rows.length,personal_fields_excluded:true},req});
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="myerrand-trust-${marketId||'all'}.csv"`);
    res.send(csv);
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

router.get('/trust/policy-acceptances', async (req,res)=>{
  try { const [rows]=await pool.execute(`SELECT policy_type,policy_version,COUNT(*) acceptances,MAX(accepted_at) last_accepted_at FROM policy_acceptances GROUP BY policy_type,policy_version ORDER BY policy_type,policy_version DESC`); res.json({success:true,acceptances:rows}); }
  catch(e){res.status(500).json({success:false,error:e.message});}
});


router.get('/financial-reconciliation', async (req,res)=>{
  try{
    const {buildFinancialReconciliation}=require('../services/financialReconciliation');
    const report=await buildFinancialReconciliation({currency:req.query.currency||null,actorId:req.user.id});
    res.json({success:true,report,warning:'This is a report only. No discrepancies are automatically repaired.'});
  }catch(e){res.status(500).json({success:false,error:'Financial reconciliation failed'});}
});

module.exports = router;
