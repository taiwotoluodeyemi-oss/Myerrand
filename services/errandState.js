const { DISPUTE_WINDOW_HOURS } = require('../config/marketplace');
const { enqueueEvent } = require('./eventOutbox');

const LEGACY_TO_CANONICAL = Object.freeze({
  assigned: 'accepted',
  in_progress: 'picked_up',
});

const TIMESTAMP_BY_STATUS = Object.freeze({
  paid: 'paid_at',
  accepted: 'accepted_at',
  picked_up: 'picked_up_at',
  delivered: 'delivered_at',
  completed: 'completed_at',
  cancelled: 'cancelled_at',
  disputed: 'disputed_at',
});

const TRANSITIONS = Object.freeze({
  pending: new Set(['paid', 'cancelled']),
  paid: new Set(['accepted', 'cancelled']),
  accepted: new Set(['picked_up', 'cancelled', 'disputed']),
  picked_up: new Set(['delivered', 'disputed']),
  delivered: new Set(['completed', 'disputed']),
  completed: new Set(['disputed']),
  disputed: new Set(['completed', 'cancelled']),
  cancelled: new Set(),
});

function canonicalStatus(status) {
  return LEGACY_TO_CANONICAL[status] || status;
}

function assertTransition(currentStatus, targetStatus) {
  const current = canonicalStatus(currentStatus);
  const target = canonicalStatus(targetStatus);
  if (current === target) return;
  if (!TRANSITIONS[current]?.has(target)) {
    const error = new Error(`Illegal errand transition: ${current} -> ${target}`);
    error.status = 409;
    error.code = 'ILLEGAL_ERRAND_TRANSITION';
    throw error;
  }
}

function assertActor(errand, actor, targetStatus) {
  const role = actor?.userType || actor?.user_type || actor?.role;
  if (role === 'admin') return;
  const canonical = canonicalStatus(targetStatus);
  if (['accepted', 'picked_up', 'delivered', 'completed'].includes(canonical)) {
    if (Number(errand.runner_id) !== Number(actor?.id)) {
      const error = new Error('Only the assigned runner can perform this transition');
      error.status = 403;
      throw error;
    }
  }
  if (canonical === 'paid' && Number(errand.client_id) !== Number(actor?.id)) {
    const error = new Error('Only the client can pay for this errand');
    error.status = 403;
    throw error;
  }
  if (canonical === 'cancelled' && Number(errand.client_id) !== Number(actor?.id)) {
    const error = new Error('Only the client can cancel a paid errand in v1');
    error.status = 403;
    throw error;
  }
}

async function transitionErrand(errandId, targetStatus, actor, connection = null, extra = {}) {
  const { pool } = require('../config/db.mysql');
  const ownConnection = !connection;
  const conn = connection || await pool.getConnection();
  try {
    if (ownConnection) await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM errands WHERE id = ? FOR UPDATE', [errandId]);
    if (!rows.length) {
      const error = new Error('Errand not found');
      error.status = 404;
      throw error;
    }
    const errand = rows[0];
    const current = canonicalStatus(errand.status);
    const target = canonicalStatus(targetStatus);

    assertTransition(current, target);
    assertActor(errand, actor, target);

    if (target === 'disputed' && ['completed'].includes(current)) {
      if (!errand.completed_at) {
        const error = new Error('Completed errand has no completed_at timestamp');
        error.status = 409;
        throw error;
      }
      const ageMs = Date.now() - new Date(errand.completed_at).getTime();
      if (ageMs > DISPUTE_WINDOW_HOURS * 60 * 60 * 1000) {
        const error = new Error('Dispute window has expired');
        error.status = 409;
        throw error;
      }
    }

    const timestampColumn = TIMESTAMP_BY_STATUS[target];
    const sets = ['status = ?'];
    const params = [target];
    if (timestampColumn) {
      sets.push(`${timestampColumn} = COALESCE(${timestampColumn}, NOW())`);
    }
    if (target === 'paid') {
      sets.push("payment_status = 'paid'");
      sets.push('is_paid = TRUE');
    }
    if (target === 'cancelled') {
      sets.push("payment_status = CASE WHEN payment_status IN ('escrowed','paid') THEN 'refunded' ELSE payment_status END");
    }
    if (extra.payment_status) {
      sets.push('payment_status = ?');
      params.push(extra.payment_status);
    }
    params.push(errandId);
    await conn.execute(`UPDATE errands SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, params);

    const eventErrand = { ...errand, id: errand.id, status: target, runner_id: errand.runner_id };
    const refreshedTimestamp = timestampColumn ? new Date().toISOString() : null;
    if (timestampColumn) eventErrand[timestampColumn] = errand[timestampColumn] || refreshedTimestamp;
    await enqueueEvent(conn, { eventType: target, errand: eventErrand, payload: {
      ...require('./eventOutbox').eventPayload?.(eventErrand, target),
      type: target, errand_id: errand.id, status: target, client_id: errand.client_id, runner_id: errand.runner_id,
      reference: errand.business_reference || null, market_id: errand.market_id || null, zone: errand.zone || null, actor_id: actor?.id || null,
      timestamps: { paid_at: eventErrand.paid_at || null, accepted_at: eventErrand.accepted_at || null, picked_up_at: eventErrand.picked_up_at || null, delivered_at: eventErrand.delivered_at || null, completed_at: eventErrand.completed_at || null, cancelled_at: eventErrand.cancelled_at || null, disputed_at: eventErrand.disputed_at || null },
    }});

    if (ownConnection) await conn.commit();
    return { ...errand, status: target };
  } catch (error) {
    if (ownConnection) await conn.rollback();
    throw error;
  } finally {
    if (ownConnection) conn.release();
  }
}

module.exports = {
  LEGACY_TO_CANONICAL,
  canonicalStatus,
  assertTransition,
  transitionErrand,
};
