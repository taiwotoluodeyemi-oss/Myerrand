const { pool } = require('../config/db.mysql');
const {
  ESCROW_RELEASE_HOURS,
  JOB_EXPIRE_HOURS,
} = require('../config/marketplace');
const { enqueueEvent } = require('./eventOutbox');

async function getOrCreateWalletForUpdate(conn, userId, walletType, currency) {
  await conn.execute(
    `INSERT INTO wallets (user_id, wallet_type, currency, balance, status)
     VALUES (?, ?, ?, 0.00, 'active')
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [userId, walletType, currency]
  );
  const [rows] = await conn.execute(
    `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = ? AND currency = ? AND status = 'active' FOR UPDATE`,
    [userId, walletType, currency]
  );
  if (!rows.length) throw new Error(`Unable to load ${walletType} wallet`);
  return rows[0];
}

async function appendLedger(conn, {
  fromWalletId = null,
  toWalletId = null,
  errandId = null,
  transactionType,
  amount,
  currency = 'USD',
  actorId = null,
  reason = '',
  isDemo = false,
}) {
  const [result] = await conn.execute(
    `INSERT INTO wallet_transactions
      (from_wallet_id, to_wallet_id, errand_id, transaction_type, amount, currency,
       description, status, processed_at, actor_id, reason, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', NOW(), ?, ?, ?)`,
    [fromWalletId, toWalletId, errandId, transactionType, amount, currency, reason, actorId, reason, isDemo ? 1 : 0]
  );
  return result.insertId;
}

async function loadHoldForUpdate(conn, errandId) {
  const [rows] = await conn.execute(
    `SELECT h.*, e.status AS errand_status, e.payment_status, e.client_id AS errand_client_id,
            e.runner_id, e.amount AS errand_amount, e.runner_payout, e.delivered_at, e.completed_at, e.business_reference, e.market_id, e.zone,
            (SELECT COUNT(*) FROM errand_disputes d WHERE d.errand_id = h.errand_id AND d.status = 'open') AS open_dispute
     FROM errand_holds h
     JOIN errands e ON e.id = h.errand_id
     WHERE h.errand_id = ? FOR UPDATE`,
    [errandId]
  );
  return rows[0] || null;
}

async function createHold(errandId, actorId = null, currency = 'USD', isDemo = false) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [errands] = await conn.execute('SELECT * FROM errands WHERE id = ? FOR UPDATE', [errandId]);
    if (!errands.length) throw Object.assign(new Error('Errand not found'), { status: 404 });
    const errand = errands[0];
    if (actorId != null && Number(errand.client_id) !== Number(actorId)) throw Object.assign(new Error('Not authorized to pay for this errand'), { status: 403 });
    if (!['pending', 'paid'].includes(errand.status) || ['escrowed', 'released'].includes(errand.payment_status)) {
      throw Object.assign(new Error('Errand is not payable'), { status: 409 });
    }
    const [existing] = await conn.execute('SELECT * FROM errand_holds WHERE errand_id = ? FOR UPDATE', [errandId]);
    if (existing.length) {
      if (existing[0].status === 'held') {
        await conn.commit();
        return { success: true, idempotent: true, hold: existing[0] };
      }
      throw Object.assign(new Error(`Errand hold is already ${existing[0].status}`), { status: 409 });
    }

    const amount = Number(errand.amount ?? errand.budget_amount ?? 0);
    if (!(amount > 0)) throw Object.assign(new Error('Errand amount must be greater than zero'), { status: 400 });
    const clientWallet = await getOrCreateWalletForUpdate(conn, errand.client_id, 'spendable', currency);
    if (Number(clientWallet.balance) < amount) throw Object.assign(new Error('Insufficient spendable balance'), { status: 400 });
    const escrowWallet = await getOrCreateWalletForUpdate(conn, errand.client_id, 'escrow', currency);

    await conn.execute('UPDATE wallets SET balance = balance - ?, updated_at = NOW() WHERE id = ?', [amount, clientWallet.id]);
    await conn.execute('UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE id = ?', [amount, escrowWallet.id]);
    const [holdResult] = await conn.execute(
      `INSERT INTO errand_holds (errand_id, client_id, amount, currency, status, held_at)
       VALUES (?, ?, ?, ?, 'held', NOW())`,
      [errandId, errand.client_id, amount, currency]
    );
    await appendLedger(conn, {
      fromWalletId: clientWallet.id,
      toWalletId: escrowWallet.id,
      errandId,
      transactionType: 'escrow_hold',
      amount,
      currency,
      actorId,
      reason: `Errand #${errandId} hold`,
      isDemo,
    });
    await conn.execute(
      `UPDATE errands SET status = 'paid', payment_status = 'escrowed', is_paid = TRUE, paid_at = COALESCE(paid_at, NOW()), updated_at = NOW() WHERE id = ?`,
      [errandId]
    );
    await enqueueEvent(conn, { eventType: 'paid', errand: { ...errand, status: 'paid' }, payload: {
      type: 'paid', errand_id: errandId, status: 'paid', reference: errand.business_reference || null,
      market_id: errand.market_id || null, zone: errand.zone || null, client_id: errand.client_id, runner_id: errand.runner_id || null, actor_id: actorId || null,
      timestamps: { paid_at: new Date().toISOString(), accepted_at: errand.accepted_at || null, picked_up_at: errand.picked_up_at || null, delivered_at: errand.delivered_at || null, completed_at: errand.completed_at || null, cancelled_at: errand.cancelled_at || null, disputed_at: errand.disputed_at || null }
    }});
    await conn.commit();
    return { success: true, holdId: holdResult.insertId, amount, currency };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function releaseHold(errandId, actorId = null, reason = 'Escrow release', options = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const hold = await loadHoldForUpdate(conn, errandId);
    if (!hold) throw Object.assign(new Error('Errand hold not found'), { status: 404 });
    if (hold.status === 'released') {
      await conn.commit();
      return { success: true, idempotent: true, status: 'released' };
    }
    if (hold.status === 'refunded') throw Object.assign(new Error('Refunded hold cannot be released'), { status: 409 });
    const adminResolution = reason === 'Admin resolution: release_to_runner';
    if ((hold.errand_status === 'disputed' || Number(hold.open_dispute) > 0) && !adminResolution) throw Object.assign(new Error('Disputed errand hold is frozen'), { status: 409 });
    if (!['delivered', 'completed', 'disputed'].includes(hold.errand_status)) throw Object.assign(new Error('Errand is not delivered'), { status: 409 });
    if (!hold.delivered_at) throw Object.assign(new Error('Cannot release without delivered_at'), { status: 409 });
    const dueAt = new Date(hold.delivered_at).getTime() + ESCROW_RELEASE_HOURS * 60 * 60 * 1000;
    if (Date.now() < dueAt && !adminResolution) throw Object.assign(new Error('Escrow release window has not elapsed'), { status: 409 });
    if (!hold.runner_id) throw Object.assign(new Error('Cannot release without an assigned runner'), { status: 409 });

    const heldAmount = Number(hold.amount);
    const runnerPayout = hold.runner_payout != null ? Number(hold.runner_payout) : (hold.errand_amount != null ? Number(hold.errand_amount) : heldAmount);
    if (!(runnerPayout >= 0 && runnerPayout <= heldAmount)) throw Object.assign(new Error('Invalid runner payout'), { status: 409 });
    const escrowWallet = await getOrCreateWalletForUpdate(conn, hold.errand_client_id, 'escrow', hold.currency);
    const runnerWallet = await getOrCreateWalletForUpdate(conn, hold.runner_id, 'withdrawable', hold.currency);
    if (Number(escrowWallet.balance) < heldAmount) throw Object.assign(new Error('Insufficient escrow balance'), { status: 409 });

    await conn.execute('UPDATE wallets SET balance = balance - ?, updated_at = NOW() WHERE id = ?', [heldAmount, escrowWallet.id]);
    if (runnerPayout > 0) await conn.execute('UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE id = ?', [runnerPayout, runnerWallet.id]);
    await conn.execute(`UPDATE errand_holds SET status = 'released', released_at = COALESCE(released_at, NOW()) WHERE id = ?`, [hold.id]);
    await conn.execute(`UPDATE errands SET payment_status = 'released', updated_at = NOW() WHERE id = ?`, [errandId]);
    if (options.finalizeStatus === 'completed') {
      await conn.execute(`UPDATE errands SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW() WHERE id = ?`, [errandId]);
    }
    await appendLedger(conn, {
      fromWalletId: escrowWallet.id,
      toWalletId: runnerWallet.id,
      errandId,
      transactionType: 'escrow_release',
      amount: runnerPayout,
      currency: hold.currency,
      actorId,
      reason,
      isDemo: false,
    });
    await enqueueEvent(conn, { eventType: 'release', errandId, payload: {
      type: 'release', errand_id: errandId, status: options.finalizeStatus === 'completed' ? 'completed' : hold.errand_status,
      reference: hold.business_reference || null, market_id: hold.market_id || null, zone: hold.zone || null, client_id: hold.errand_client_id, runner_id: hold.runner_id, actor_id: actorId || null,
      amount: runnerPayout, currency: hold.currency, reason, timestamps: { delivered_at: hold.delivered_at || null, completed_at: options.finalizeStatus === 'completed' ? new Date().toISOString() : hold.completed_at || null }
    }});
    await conn.commit();
    return { success: true, idempotent: false, status: 'released', runner_payout: runnerPayout, held_amount: heldAmount };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function refundHold(errandId, actorId = null, reason = 'Errand refund', options = {}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const hold = await loadHoldForUpdate(conn, errandId);
    if (!hold) throw Object.assign(new Error('Errand hold not found'), { status: 404 });
    if (hold.status === 'refunded') {
      await conn.commit();
      return { success: true, idempotent: true, status: 'refunded' };
    }
    if (hold.status === 'released') throw Object.assign(new Error('Released hold cannot be refunded'), { status: 409 });
    const adminResolution = reason === 'Admin resolution: refund_to_client' || reason === 'Admin resolution: cancel_no_pay';
    if ((hold.errand_status === 'disputed' || Number(hold.open_dispute) > 0) && !adminResolution) throw Object.assign(new Error('Disputed errand hold is frozen'), { status: 409 });

    const clientSpendable = await getOrCreateWalletForUpdate(conn, hold.errand_client_id, 'spendable', hold.currency);
    const escrowWallet = await getOrCreateWalletForUpdate(conn, hold.errand_client_id, 'escrow', hold.currency);
    const amount = Number(hold.amount);
    if (Number(escrowWallet.balance) < amount) throw Object.assign(new Error('Insufficient escrow balance for refund'), { status: 409 });
    await conn.execute('UPDATE wallets SET balance = balance - ?, updated_at = NOW() WHERE id = ?', [amount, escrowWallet.id]);
    await conn.execute('UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE id = ?', [amount, clientSpendable.id]);
    await conn.execute(`UPDATE errand_holds SET status = 'refunded', refunded_at = COALESCE(refunded_at, NOW()) WHERE id = ?`, [hold.id]);
    await conn.execute(`UPDATE errands SET payment_status = 'refunded', updated_at = NOW() WHERE id = ?`, [errandId]);
    if (options.finalizeStatus === 'cancelled') {
      await conn.execute(`UPDATE errands SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), updated_at = NOW() WHERE id = ?`, [errandId]);
    }
    await appendLedger(conn, {
      fromWalletId: escrowWallet.id,
      toWalletId: clientSpendable.id,
      errandId,
      transactionType: 'refund',
      amount,
      currency: hold.currency,
      actorId,
      reason,
      isDemo: false,
    });
    await enqueueEvent(conn, { eventType: 'refund', errandId, payload: {
      type: 'refund', errand_id: errandId, status: options.finalizeStatus === 'cancelled' ? 'cancelled' : hold.errand_status,
      reference: hold.business_reference || null, market_id: hold.market_id || null, zone: hold.zone || null, client_id: hold.errand_client_id, runner_id: hold.runner_id || null, actor_id: actorId || null,
      amount, currency: hold.currency, reason, timestamps: { paid_at: null, cancelled_at: options.finalizeStatus === 'cancelled' ? new Date().toISOString() : null }
    }});
    await conn.commit();
    return { success: true, idempotent: false, status: 'refunded', amount };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function processDueReleases() {
  const [rows] = await pool.execute(
    `SELECT h.errand_id FROM errand_holds h
     JOIN errands e ON e.id = h.errand_id
     WHERE h.status = 'held'
       AND e.status IN ('delivered','completed')
       AND e.delivered_at IS NOT NULL
       AND e.delivered_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)
       AND NOT EXISTS (SELECT 1 FROM errand_disputes d WHERE d.errand_id = h.errand_id AND d.status = 'open')`,
    [ESCROW_RELEASE_HOURS]
  );
  const results = [];
  for (const row of rows) {
    try { results.push(await releaseHold(row.errand_id, null, 'Automatic escrow release')); }
    catch (error) { results.push({ errandId: row.errand_id, success: false, error: error.message }); }
  }
  return results;
}

async function processDueRefunds() {
  const [rows] = await pool.execute(
    `SELECT h.errand_id FROM errand_holds h
     JOIN errands e ON e.id = h.errand_id
     WHERE h.status = 'held'
       AND e.status = 'paid'
       AND e.runner_id IS NULL
       AND e.paid_at IS NOT NULL
       AND e.paid_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
    [JOB_EXPIRE_HOURS]
  );
  const results = [];
  for (const row of rows) {
    try {
      const result = await refundHold(row.errand_id, null, 'Automatic job expiry refund', { finalizeStatus: 'cancelled' });
      await pool.execute(`UPDATE errands SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()), updated_at = NOW() WHERE id = ? AND status = 'paid'`, [row.errand_id]);
      results.push(result);
    } catch (error) { results.push({ errandId: row.errand_id, success: false, error: error.message }); }
  }
  return results;
}

module.exports = {
  createHold,
  releaseHold,
  refundHold,
  processDueReleases,
  processDueRefunds,
};
