const { pool } = require('../config/db.mysql');
const { isPaystackConfigured, isPaypalConfigured, isPaypalPayoutsConfigured } = require('../utils/payment-config');
const mongoose = require('mongoose');

const counters = new Map();
const latency = { count: 0, totalMs: 0, maxMs: 0 };
const startedAt = Date.now();

function inc(name, value = 1) {
  counters.set(name, (counters.get(name) || 0) + Number(value || 0));
}
function observeRequest(durationMs, status) {
  latency.count += 1;
  latency.totalMs += Number(durationMs || 0);
  latency.maxMs = Math.max(latency.maxMs, Number(durationMs || 0));
  inc('requests');
  if (Number(status) >= 500) inc('errors');
}
function recordLoginFailure() { inc('login_failures'); }
function recordPaymentFailure() { inc('payment_failures'); }
function recordWebhookFailure() { inc('webhook_failures'); }
function record(name, value = 1) { inc(name, value); }
function redact(value) { return String(value ?? '').replace(/(password|secret|token|authorization|api[-_ ]?key|payment[-_ ]?secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]'); }

function snapshot() {
  const values = Object.fromEntries(counters.entries());
  return {
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    requests: values.requests || 0,
    errors: values.errors || 0,
    latency: {
      count: latency.count,
      avg_ms: latency.count ? Number((latency.totalMs / latency.count).toFixed(2)) : 0,
      max_ms: Number(latency.maxMs.toFixed(2)),
    },
    counters: values,
  };
}

async function databaseHealth() {
  const started = Date.now();
  try {
    await pool.execute('SELECT 1 AS ok');
    return { ok: true, latency_ms: Date.now() - started };
  } catch (error) {
    return { ok: false, latency_ms: Date.now() - started, error_code: error.code || 'DATABASE_ERROR' };
  }
}

async function dependencyHealth() {
  const db = await databaseHealth();
  return {
    ok: db.ok,
    dependencies: {
      mysql: { configured: true, ok: db.ok },
      mongodb: { configured: process.env.USE_MONGO === 'true', ok: process.env.USE_MONGO === 'true' ? mongoose.connection.readyState === 1 : null },
      paystack: { configured: isPaystackConfigured(), ok: isPaystackConfigured() },
      paypal: { configured: isPaypalConfigured(), ok: isPaypalConfigured() },
      paypal_payouts: { configured: isPaypalPayoutsConfigured(), ok: isPaypalPayoutsConfigured() },
      webhook_signing: { configured: Boolean(process.env.WEBHOOK_ENCRYPTION_KEY || process.env.JWT_SECRET) },
    },
  };
}

async function financialAlerts() {
  const alerts = [];
  const queries = [
    ['negative_wallet', `SELECT id,user_id,currency,balance FROM wallets WHERE balance < 0 ORDER BY id LIMIT 100`, rows => rows.map(r => ({ id: r.id, user_id: r.user_id, currency: r.currency, balance: Number(r.balance) }))],
    ['orphaned_hold', `SELECT h.id,h.errand_id,h.amount,h.currency FROM errand_holds h LEFT JOIN errands e ON e.id=h.errand_id WHERE e.id IS NULL LIMIT 100`, rows => rows.map(r => ({ id: r.id, errand_id: r.errand_id, amount: Number(r.amount), currency: r.currency }))],
    ['released_and_refunded_hold', `SELECT id,errand_id,amount,currency,status,released_at,refunded_at FROM errand_holds WHERE status='refunded' AND released_at IS NOT NULL LIMIT 100`, rows => rows.map(r => ({ id: r.id, errand_id: r.errand_id, amount: Number(r.amount), currency: r.currency }))],
    ['missing_ledger_entry', `SELECT h.id,h.errand_id,h.amount,h.currency,h.status FROM errand_holds h LEFT JOIN wallet_transactions wt ON wt.errand_id=h.errand_id AND wt.transaction_type IN ('escrow_hold','escrow_release','refund') AND wt.status='completed' WHERE h.status IN ('held','released','refunded') AND wt.id IS NULL LIMIT 100`, rows => rows.map(r => ({ id: r.id, errand_id: r.errand_id, status: r.status, amount: Number(r.amount), currency: r.currency }))],
    ['stuck_payment', `SELECT id,reference,user_id,amount,currency,status,created_at FROM payment_intents WHERE status IN ('initialized','processing') AND created_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE) LIMIT 100`, rows => rows.map(r => ({ id: r.id, reference: r.reference, user_id: r.user_id, amount: Number(r.amount), currency: r.currency, status: r.status }))],
    ['repeated_failed_verification', `SELECT user_id,COUNT(*) AS failures,MAX(created_at) AS last_failed_at FROM audit_logs WHERE ((action LIKE '%verification%failure%') OR (action='verification_changed' AND details LIKE '%\"decision\":\"reject%')) AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) GROUP BY user_id HAVING COUNT(*) >= 3 LIMIT 100`, rows => rows.map(r => ({ user_id: r.user_id, failures: Number(r.failures), last_failed_at: r.last_failed_at }))],
  ];
  for (const [type, sql, map] of queries) {
    try {
      const [rows] = await pool.execute(sql);
      if (rows.length) alerts.push({ type, count: rows.length, items: map(rows) });
    } catch (error) {
      alerts.push({ type, count: null, query_error: true });
    }
  }
  return alerts;
}

async function businessMetrics() {
  const [[money], [payments], [disputes]] = await Promise.all([
    pool.execute(`SELECT
      (SELECT COUNT(*) FROM wallet_transactions WHERE transaction_type='deposit' AND status='completed') AS deposits,
      (SELECT COUNT(*) FROM wallet_transactions WHERE transaction_type='escrow_hold' AND status='completed') AS holds,
      (SELECT COUNT(*) FROM wallet_transactions WHERE transaction_type='escrow_release' AND status='completed') AS releases,
      (SELECT COUNT(*) FROM wallet_transactions WHERE transaction_type='refund' AND status='completed') AS refunds`),
    pool.execute(`SELECT
      (SELECT COUNT(*) FROM payment_intents WHERE status='failed') AS payment_failures,
      (SELECT COUNT(*) FROM payment_intents WHERE status IN ('initialized','processing')) AS stuck_payments`),
    pool.execute(`SELECT COUNT(*) AS n FROM errand_disputes WHERE status='open'`),
  ]);
  return { deposits: Number(money[0]?.deposits || 0), holds: Number(money[0]?.holds || 0), releases: Number(money[0]?.releases || 0), refunds: Number(money[0]?.refunds || 0), payment_failures: Number(payments[0]?.payment_failures || 0), stuck_payments: Number(payments[0]?.stuck_payments || 0), disputes: Number(disputes[0]?.n || 0) };
}

async function operationalSnapshot() {
  const db = await databaseHealth();
  const [[queueRows], [activeRows]] = await Promise.all([
    pool.execute(`SELECT
      (SELECT COUNT(*) FROM webhook_deliveries WHERE status IN ('pending','processing','retrying')) AS webhook_queue_depth,
      (SELECT COUNT(*) FROM webhook_deliveries WHERE status='dead_letter') AS webhook_dead_letters,
      (SELECT COUNT(*) FROM notification_failures WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS notification_failures_24h,
      (SELECT COUNT(*) FROM errand_holds WHERE status='held' AND held_at <= DATE_SUB(NOW(), INTERVAL 72 HOUR)) AS stuck_holds`),
    pool.execute(`SELECT COUNT(*) AS n FROM users WHERE (status IS NULL OR status NOT IN ('inactive','suspended')) AND (last_active IS NULL OR last_active >= DATE_SUB(NOW(), INTERVAL 15 MINUTE))`),
  ]);
  const queue = queueRows[0] || {};
  const active = Number(activeRows[0]?.n || 0);
  const [alerts, business] = await Promise.all([financialAlerts(), businessMetrics()]);
  return { process: snapshot(), business, database: db, queue, active_users: Number(active), financial_alerts: alerts, healthy: db.ok && alerts.length === 0 };
}

module.exports = { inc, record, redact, observeRequest, recordLoginFailure, recordPaymentFailure, recordWebhookFailure, snapshot, databaseHealth, dependencyHealth, financialAlerts, businessMetrics, operationalSnapshot };
