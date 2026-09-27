const { pool } = require('../config/db.mysql');
const { creditUser } = require('./financialService');

async function creditSpendable({ userId, amount, currency = 'NGN', transactionType, reason, actorId = null }) {
  return creditUser({userId,amount,currency,walletType:'spendable',transactionType,description:reason,actorId,reason,isDemo:false});
}

async function awardReferralForCompletedErrand(errandId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[e]] = await conn.execute('SELECT id, client_id, amount, market_id FROM errands WHERE id=? FOR UPDATE', [errandId]);
    if (!e) { await conn.rollback(); return { success:false, reason:'errand_not_found' }; }
    const [[a]] = await conn.execute('SELECT * FROM referral_attributions WHERE referee_user_id=? LIMIT 1', [e.client_id]);
    if (!a || Number(a.referrer_user_id) === Number(a.referee_user_id)) { await conn.rollback(); return { success:false, reason:'no_attribution' }; }
    const [[existing]] = await conn.execute('SELECT id FROM referral_rewards WHERE referee_user_id=? LIMIT 1', [e.client_id]);
    if (existing) { await conn.rollback(); return { success:true, idempotent:true }; }
    const [[cfg]] = await conn.execute(`SELECT credit_value, credit_currency FROM growth_config LIMIT 1`);
    const amount = Number(cfg?.credit_value || 500);
    const currency = cfg?.credit_currency || 'NGN';
    await creditUser({userId:a.referrer_user_id,amount,currency,walletType:'spendable',transactionType:'referral_bonus',description:'Referral first-completed-job bonus',actorId:a.referrer_user_id,reason:'referral_bonus',connection:conn});
    await conn.execute('INSERT INTO referral_rewards (referrer_user_id,referee_user_id,errand_id,amount,currency) VALUES (?,?,?,?,?)',[a.referrer_user_id,a.referee_user_id,e.id,amount,currency]);
    await conn.commit();
    return { success:true, amount, currency };
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
}

module.exports = { creditSpendable, awardReferralForCompletedErrand };
