const { pool } = require('../config/db.mysql');
const { MAX_HOLD_AGE_HOURS, JOB_EXPIRE_HOURS } = require('../config/marketplace');
const { operationalSnapshot } = require('./observability');

function paging(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.page_size || query.limit, 10) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
function filters(query = {}) {
  const params = [];
  const where = [];
  if (query.market) { where.push('e.market_id = ?'); params.push(String(query.market)); }
  if (query.zone) { where.push('e.zone = ?'); params.push(String(query.zone)); }
  if (query.from) { where.push('e.created_at >= ?'); params.push(String(query.from)); }
  if (query.to) { where.push('e.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(String(query.to)); }
  if (query.search) { where.push('(CAST(e.id AS CHAR) LIKE ? OR e.title LIKE ?)'); const s = `%${String(query.search).slice(0,100)}%`; params.push(s,s); }
  return { where: where.length ? ` AND ${where.join(' AND ')}` : '', params };
}
function age(created) { const ms = Date.now() - new Date(created).getTime(); return `${Math.max(0, Math.floor(ms / 3600000))}h`; }
function severity(kind, row) {
  if (kind === 'stuck_holds') return Number(row.age_hours || 0) >= MAX_HOLD_AGE_HOURS * 2 ? 'critical' : 'high';
  if (kind === 'failed_payments') return row.status === 'failed' ? 'high' : 'medium';
  if (kind === 'dead_letter_events') return 'high';
  if (kind === 'open_disputes' || kind === 'payment_disputes') return 'medium';
  if (kind === 'verification_queue') return 'medium';
  if (kind === 'high_dispute_users') return Number(row.dispute_count || 0) >= 10 ? 'high' : 'medium';
  return 'medium';
}
function item(kind, row, action, stateField = 'status') {
  return { ...row, age: age(row.created_at || row.opened_at || row.held_at || row.paid_at || row.last_seen_at), severity: severity(kind, row), market: row.market_id || null, zone: row.zone || null, responsible_action: action, current_state: row[stateField] || row.status || null };
}

async function listOperations(query = {}) {
  const { page, pageSize, offset } = paging(query);
  const f = filters(query);
  const result = {};
  const q = async (sql, params) => (await pool.execute(sql, params))[0];
  const base = f.where;

  result.open_disputes = (await q(`SELECT d.id,d.errand_id,d.reason_code,d.status,d.created_at,e.title,e.status AS errand_status,e.market_id,e.zone FROM errand_disputes d JOIN errands e ON e.id=d.errand_id WHERE d.status='open'${base} ORDER BY d.created_at ASC LIMIT ${pageSize} OFFSET ${offset}`, f.params)).map(r=>item('open_disputes',r,'Review dispute; use the existing dispute/money service.'));
  result.stuck_holds = (await q(`SELECT h.id,h.errand_id,h.amount,h.currency,h.status,h.held_at AS created_at,TIMESTAMPDIFF(HOUR,h.held_at,NOW()) age_hours,e.status AS errand_status,e.market_id,e.zone FROM errand_holds h JOIN errands e ON e.id=h.errand_id WHERE h.status='held' AND h.held_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)${base} ORDER BY h.held_at ASC LIMIT ${pageSize} OFFSET ${offset}`, [MAX_HOLD_AGE_HOURS,...f.params])).map(r=>item('stuck_holds',r,'Inspect hold; release/refund only through existing errand money service.'));
  result.failed_payments = (await q(`SELECT p.id,p.reference,p.status,p.amount,p.currency,p.created_at,p.user_id,NULL AS market_id,NULL AS zone FROM payment_intents p WHERE p.status='failed' ORDER BY p.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`, f.params)).map(r=>item('failed_payments',r,'Inspect provider result and payment service; do not edit balances.'));
  result.failed_webhooks = (await q(`SELECT d.id,d.status,d.attempts,d.last_error,d.response_code,d.created_at,s.url,s.market_id,s.zone FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE d.status IN ('retrying','dead_letter') ORDER BY d.created_at ASC LIMIT ${pageSize} OFFSET ${offset}`, [])).map(r=>item('failed_webhooks',r,'Inspect delivery; replay dead-letter only through eventOutbox.'));
  result.dead_letter_events = result.failed_webhooks.filter(r=>r.current_state==='dead_letter');
  result.unaccepted_paid_errands = (await q(`SELECT e.id,e.title,e.status,e.payment_status,e.paid_at AS created_at,e.market_id,e.zone FROM errands e WHERE e.payment_status='escrowed' AND e.status='paid' AND e.runner_id IS NULL AND e.paid_at IS NOT NULL ORDER BY e.paid_at ASC LIMIT ${pageSize} OFFSET ${offset}`, [])).map(r=>item('unaccepted_paid_errands',r,'Contact/dispatch; automatic expiry remains in the existing money worker.'));
  result.verification_queue = (await q(`SELECT r.user_id,r.verification_status,r.created_at,u.status AS user_status FROM runners r JOIN users u ON u.id=r.user_id WHERE r.id_document_path IS NOT NULL AND COALESCE(r.verification_status,'pending') NOT IN ('approved','rejected') ORDER BY r.created_at ASC LIMIT ${pageSize} OFFSET ${offset}`, [])).map(r=>item('verification_queue',r,'Review verification using the verification service; do not expose ID documents.'));
  result.payment_disputes = (await q(`SELECT p.id,p.errand_id,p.status,p.reason_code,p.created_at,e.market_id,e.zone FROM payment_disputes p LEFT JOIN errands e ON e.id=p.errand_id WHERE p.status IN ('open','evidence')${f.where} ORDER BY p.created_at ASC LIMIT ${pageSize} OFFSET ${offset}`, f.params)).map(r=>item('payment_disputes',r,'Review payment dispute evidence and use the existing dispute workflow.'));
  result.high_dispute_users = (await q(`SELECT d.opened_by AS user_id,COUNT(*) dispute_count,MAX(d.created_at) created_at,MAX(e.market_id) market_id,MAX(e.zone) zone FROM errand_disputes d JOIN errands e ON e.id=d.errand_id WHERE d.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) GROUP BY d.opened_by HAVING COUNT(*) >= 3 ORDER BY dispute_count DESC LIMIT ${pageSize} OFFSET ${offset}`, [])).map(r=>item('high_dispute_users',r,'Review risk history; do not suspend or debit automatically.'));
  result.system_health = [await operationalSnapshot()];
  result.pagination = { page, page_size: pageSize, note: 'Each queue is independently bounded; system_health is a singleton.' };
  return result;
}

module.exports = { listOperations, paging, filters };
