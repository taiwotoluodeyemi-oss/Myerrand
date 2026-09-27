const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/db.mysql');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { creditSpendable } = require('../services/growthLedger');
const { refundHold } = require('../services/errandMoney');
const { creditUser } = require('../services/financialService');
const router = express.Router();

function makeReferralCode(userId) { return `ERR-${String(userId).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

router.get('/referral-code', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT code FROM referral_codes WHERE user_id=? LIMIT 1', [req.user.id]);
    if (rows.length) return res.json({ success: true, code: rows[0].code });
    const code = makeReferralCode(req.user.id);
    await pool.execute('INSERT INTO referral_codes (user_id,code) VALUES (?,?)', [req.user.id, code]);
    res.status(201).json({ success: true, code });
  } catch (e) { res.status(500).json({ success: false, error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message }); }
});

router.post('/referral/apply', verifyToken, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ success: false, error: 'Referral code required' });
    const [[ref]] = await pool.execute('SELECT user_id,active FROM referral_codes WHERE code=?', [code]);
    if (!ref || !ref.active) return res.status(404).json({ success: false, error: 'Referral code not found' });
    if (Number(ref.user_id) === Number(req.user.id)) return res.status(400).json({ success: false, error: 'Self-referral is not allowed' });
    const [[existing]] = await pool.execute('SELECT id FROM referral_attributions WHERE referee_user_id=? LIMIT 1', [req.user.id]);
    if (existing) return res.status(409).json({ success: false, error: 'Referral already applied' });
    await pool.execute('INSERT INTO referral_attributions (referrer_user_id,referee_user_id,code) VALUES (?,?,?)', [ref.user_id, req.user.id, code]);
    res.status(201).json({ success: true, message: 'Referral applied' });
  } catch (e) { res.status(500).json({ success: false, error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message }); }
});

router.post('/promos/redeem', verifyToken, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const currency = String(req.body?.currency || 'NGN').toUpperCase();
    if (!code) return res.status(400).json({ success: false, error: 'Promo code required' });
    await conn.beginTransaction();
    const [[promo]] = await conn.execute('SELECT * FROM promo_codes WHERE code=? AND active=TRUE FOR UPDATE', [code]);
    if (!promo) throw Object.assign(new Error('Promo code not found'), { status: 404 });
    if (promo.expires_at && new Date(promo.expires_at).getTime() < Date.now()) throw Object.assign(new Error('Promo code expired'), { status: 409 });
    const [[count]] = await conn.execute('SELECT COUNT(*) n FROM promo_redemptions WHERE promo_id=?', [promo.id]);
    if (Number(count.n) >= Number(promo.max_redemptions)) throw Object.assign(new Error('Promo redemption limit reached'), { status: 409 });
    const [[mine]] = await conn.execute('SELECT id FROM promo_redemptions WHERE promo_id=? AND user_id=?', [promo.id, req.user.id]);
    if (mine) throw Object.assign(new Error('Promo already redeemed by this user'), { status: 409 });
    const base = Number(req.body?.base_amount || 0);
    const amount = promo.credit_type === 'percent' ? Math.max(0, base * Number(promo.credit_value) / 100) : Number(promo.credit_value);
    if (!(amount > 0)) throw Object.assign(new Error('Promo credit amount must be greater than zero'), { status: 400 });
    const walletResult = await creditUser({userId:req.user.id,amount,currency,walletType:'spendable',transactionType:'promo_credit',description:`Promo ${code}`,actorId:req.user.id,reason:`promo_credit:${code}`,connection:conn});
    await conn.execute('INSERT INTO promo_redemptions (promo_id,user_id,amount,currency) VALUES (?,?,?,?)', [promo.id,req.user.id,amount,currency]);
    await conn.commit();
    res.status(201).json({ success:true, amount, currency, code });
  } catch(e) { try { await conn.rollback(); } catch(_){} res.status(e.status||500).json({success:false,error:e.message}); }
  finally { conn.release(); }
});

router.post('/waitlist', async (req,res)=>{
  try {
    const { zone, market_id=null, name=null, email=null, phone=null } = req.body || {};
    if (!zone || (!email && !phone)) return res.status(400).json({success:false,error:'zone and email or phone are required'});
    const [r]=await pool.execute('INSERT INTO zone_waitlist (zone,market_id,name,email,phone) VALUES (?,?,?,?,?)',[zone,market_id,name,email,phone]);
    res.status(201).json({success:true,id:r.insertId});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

router.get('/payment-disputes', verifyToken, requireAdmin, async(req,res)=>{
  try { const [rows]=await pool.execute(`SELECT p.*,e.title,e.status errand_status,e.payment_status,h.status hold_status,h.amount,h.currency FROM payment_disputes p LEFT JOIN errands e ON e.id=p.errand_id LEFT JOIN errand_holds h ON h.errand_id=p.errand_id ORDER BY p.created_at DESC LIMIT 200`); res.json({success:true,cases:rows}); }
  catch(e){res.status(500).json({success:false,error:e.message});}
});

router.post('/payment-disputes', verifyToken, requireAdmin, async(req,res)=>{
  try { const {errand_id=null,deposit_id=null,reason_code,note}=req.body||{}; if(!reason_code||!note)return res.status(400).json({success:false,error:'reason_code and note are required'}); const [r]=await pool.execute(`INSERT INTO payment_disputes (errand_id,deposit_id,opened_by,reason_code,note) VALUES (?,?,?,?,?)`,[errand_id,deposit_id,req.user.id,reason_code,note]); res.status(201).json({success:true,id:r.insertId}); }
  catch(e){res.status(500).json({success:false,error:e.message});}
});

router.post('/payment-disputes/:id/evidence', verifyToken, requireAdmin, async(req,res)=>{ const [r]=await pool.execute(`UPDATE payment_disputes SET status='evidence',updated_at=NOW() WHERE id=? AND status='open'`,[req.params.id]); res.json({success:r.affectedRows>0}); });
router.post('/payment-disputes/:id/withdraw', verifyToken, requireAdmin, async(req,res)=>{ const [r]=await pool.execute(`UPDATE payment_disputes SET status='withdrawn',resolved_by=?,resolved_at=NOW(),resolution_note=? WHERE id=? AND status IN ('open','evidence')`,[req.user.id,req.body?.note||'',req.params.id]); res.json({success:r.affectedRows>0}); });

router.post('/payment-disputes/:id/resolve', verifyToken, requireAdmin, async(req,res)=>{
  const conn=await pool.getConnection();
  try{
    const outcome=String(req.body?.outcome||'').toLowerCase();
    if(!['won','lost'].includes(outcome)) return res.status(400).json({success:false,error:'outcome must be won or lost'});
    await conn.beginTransaction();
    const [[c]]=await conn.execute(`SELECT * FROM payment_disputes WHERE id=? FOR UPDATE`,[req.params.id]);
    if(!c)return res.status(404).json({success:false,error:'Payment dispute not found'});
    if(!['open','evidence'].includes(c.status))return res.status(409).json({success:false,error:'Case is already resolved'});
    await conn.commit();
    let money=null;
    if(outcome==='lost' && c.errand_id){
      const [[hold]]=await pool.execute('SELECT * FROM errand_holds WHERE errand_id=?',[c.errand_id]);
      if(hold?.status==='held') money=await refundHold(c.errand_id,req.user.id,'Payment dispute lost: refund_to_client',{finalizeStatus:'cancelled'});
      else if(hold?.status==='released') {
        const [[runner]] = await pool.execute('SELECT runner_id FROM errands WHERE id=?',[c.errand_id]);
        const [[wallet]] = runner?.runner_id ? await pool.execute(`SELECT id,currency FROM wallets WHERE user_id=? AND wallet_type='withdrawable' ORDER BY id LIMIT 1`,[runner.runner_id]) : [[]];
        if(wallet?.id){ await pool.execute(`INSERT INTO wallet_transactions (from_wallet_id,to_wallet_id,errand_id,transaction_type,amount,currency,description,status,processed_at,actor_id,reason,is_demo) VALUES (NULL,?,?,?,?,?,?, 'completed',NOW(),?,?,0)`,[wallet.id,c.errand_id,'platform_loss',Number(hold.amount),hold.currency,'Payment dispute loss',req.user.id,'platform_loss']); }
        else await pool.execute(`INSERT INTO wallet_transactions (errand_id,transaction_type,amount,currency,description,status,processed_at,actor_id,reason,is_demo) VALUES (?,?,?,?,?,'completed',NOW(),?,?,0)`,[c.errand_id,'platform_loss',Number(hold.amount),hold.currency,'Payment dispute loss',req.user.id,'platform_loss']);
        money={success:true,platform_loss:true,amount:Number(hold.amount),currency:hold.currency};
      }
    }
    await pool.execute(`UPDATE payment_disputes SET status=?,resolved_by=?,resolved_at=NOW(),resolution_note=?,updated_at=NOW() WHERE id=?`,[outcome,req.user.id,req.body?.note||'',c.id]);
    res.json({success:true,status:outcome,money});
  }catch(e){try{await conn.rollback();}catch(_){} res.status(e.status||500).json({success:false,error:e.message});}finally{conn.release();}
});

router.get('/notifier-status', verifyToken, requireAdmin, async(req,res)=>{ const {Notifier}=require('../services/notifier'); res.json({success:true,providers:Notifier.status(),in_app:'always'}); });

module.exports=router;
