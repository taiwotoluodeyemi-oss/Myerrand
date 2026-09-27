const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');

// Database connection
const { pool } = require('../config/db.mysql');
const db = pool;

// Import wallet utilities
const { getAllWalletBalances } = require('../utils/wallet-utils');
// Currency catalog
const { getExchangeRate: resolveExchangeRate } = require('../utils/exchange-rates');
const { currencies, getCurrencySymbol } = require('../utils/currencies');
// Payment provider readiness checks (only allow real payouts once configured)
const { isPaystackConfigured, isPaypalConfigured, isPaypalPayoutsConfigured } = require('../utils/payment-config');
const paymentPort = require('../services/paymentPort');
const { auditSecurity } = require('../services/securityAudit');
const { creditUser, debitUser, postWalletMutation, transferWallets } = require('../services/financialService');

const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const BASE_URL = 'https://api-m.sandbox.paypal.com';

// Paystack configuration
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// =======================
// HELPER FUNCTIONS
// =======================

const getAccessToken = async () => {
  const res = await axios.post(`${BASE_URL}/v1/oauth2/token`, 'grant_type=client_credentials', {
    auth: { username: PAYPAL_CLIENT, password: PAYPAL_SECRET },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return res.data.access_token;
};

// Get user's wallet by type and currency
const getUserWallet = async (userId, walletType, currency = 'USD') => {
  const [wallet] = await db.execute(
    `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = ? AND currency = ? AND status = 'active'`,
    [userId, walletType, currency]
  );
  return wallet[0] || null;
};

// Create wallet if it doesn't exist
const createWallet = async (userId, walletType, currency = 'USD') => {
  const [result] = await db.execute(
    `INSERT INTO wallets (user_id, wallet_type, currency, balance, status) VALUES (?, ?, ?, 0.00, 'active')`,
    [userId, walletType, currency]
  );
  return result.insertId;
};

// Get current exchange rate (DB cache → live Frankfurter API)
const getExchangeRate = async (fromCurrency, toCurrency) => {
  const { rate } = await resolveExchangeRate(db, fromCurrency, toCurrency);
  return rate;
};

// =======================
// WALLET MANAGEMENT ROUTES
// =======================

// List supported currencies with symbols and names
router.get('/currencies', async (req, res) => {
  try {
    res.json({ success: true, currencies });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch currencies', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  }
});

// Get exchange rate
router.get('/exchange-rate', async (req, res) => {
  try {
    const { from = 'USD', to = 'USD' } = req.query;
    const rate = await getExchangeRate(from.toUpperCase(), to.toUpperCase());
    res.json({ success: true, from: from.toUpperCase(), to: to.toUpperCase(), rate });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch exchange rate', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  }
});

// Convert an amount
router.get('/convert', async (req, res) => {
  try {
    const amount = parseFloat(req.query.amount || '0');
    const from = (req.query.from || 'USD').toUpperCase();
    const to = (req.query.to || 'USD').toUpperCase();
    const rate = await getExchangeRate(from, to);
    const converted = amount * rate;
    res.json({ success: true, amount, from, to, rate, converted });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Conversion failed', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  }
});

// Get user's wallet balances with aggregated total
// BUGFIX: this used to sum balances across every currency the user holds
// (e.g. a $50 USD wallet + a ₦2000 NGN wallet became "2050"), and the
// frontend then displayed that meaningless number next to whatever currency
// was selected. We now scope to a single currency, same as /balance-summary.
router.get('/wallets', async (req, res) => {
  try {
    const userId = req.user.id;
    const currency = (req.query.currency || 'USD').toUpperCase();

    const [wallets] = await db.execute(
      `SELECT wallet_type, currency, balance, status FROM wallets WHERE user_id = ? AND currency = ? AND status = 'active'`,
      [userId, currency]
    );

    // Aggregate spendable + withdrawable + escrow balances for this currency only
    const aggregatedBalance = wallets.reduce((acc, wallet) => acc + parseFloat(wallet.balance), 0);

    res.json({ success: true, wallets, totalBalance: aggregatedBalance, currency });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch wallets', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  }
});

// Get user balance summary for header display (optionally in a target currency)
router.get('/balance-summary', async (req, res) => {
  try {
    const userId = req.user.id;
    const currency = (req.query.currency || 'USD').toUpperCase();

    const balances = await getAllWalletBalances(userId, currency);

    res.json({ 
      success: true, 
      currency,
      symbol: getCurrencySymbol(currency),
      balances: {
        spendable: balances.spendable,
        withdrawable: balances.withdrawable,
        escrow: balances.escrow,
        total: balances.total
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch balance summary', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  }
});

// Stage 4 payment port: all deposits use the same accounting path.
router.get('/deposit/provider', async (req,res)=>{ res.json({success:true,provider:paymentPort.providerName(),is_demo:paymentPort.providerName()==='demo'}); });

router.post('/deposit/intent', async (req,res)=>{
  try {
    const amount=Number(req.body.amount), currency=String(req.body.currency||'NGN').toUpperCase();
    if(!Number.isFinite(amount)||amount<=0) return res.status(400).json({success:false,message:'amount must be greater than 0'});
    const orgId=req.body.org_id||null;
    let sandbox=false;
    if(orgId){
      const [[membership]]=await db.execute(
        `SELECT o.id,o.sandbox_flag FROM organizations o
         JOIN organization_members m ON m.organization_id=o.id
         WHERE o.id=? AND m.user_id=? LIMIT 1`,
        [orgId,req.user.id]
      );
      if(!membership) return res.status(403).json({success:false,message:'Organization access denied'});
      sandbox=Boolean(membership.sandbox_flag);
    }
    const sandboxPayment = sandbox ? { is_demo: true } : { is_demo: Boolean(req.body.is_demo) };
    const result=await paymentPort.initiateDeposit({
      userId:req.user.id,amount,currency,email:req.body.email||req.user.email,orgId,
      ...sandboxPayment,idempotencyKey:req.get('Idempotency-Key')||null
    });
    const [[disclosure]] = await db.execute(`SELECT version,body FROM policy_versions WHERE policy_type='escrow_disclosure' AND active=TRUE ORDER BY created_at DESC LIMIT 1`);
    await auditSecurity({actorId:req.user.id,action:'deposit_intent_created',targetType:'organization',targetId:orgId,details:{sandbox,is_demo:Boolean(result.is_demo)},req});
    res.json({success:true,escrow_disclosure:disclosure?{version:disclosure.version,body:disclosure.body}:null,...result});

  } catch(e){ console.error('payment port initiate',e.message); res.status(e.status||500).json({success:false,message:e.status?e.message:'Failed to create deposit'}); }
});

// Backwards-compatible endpoint; still goes through the payment port.
router.post('/deposit/create-intent', async (req,res) => {
  try {
    const amount=Number(req.body.amount), currency=String(req.body.currency||'USD').toUpperCase();
    if(!Number.isFinite(amount)||amount<=0) return res.status(400).json({success:false,message:'amount must be greater than zero'});
    if(req.body.paymentMethod && req.body.paymentMethod!=='paystack') return res.status(400).json({success:false,message:'Unsupported payment method'});
    const orgId=req.body.org_id||null;
    let sandbox=false;
    if(orgId){
      const [[membership]]=await db.execute(
        `SELECT o.id,o.sandbox_flag FROM organizations o
         JOIN organization_members m ON m.organization_id=o.id
         WHERE o.id=? AND m.user_id=? LIMIT 1`,
        [orgId,req.user.id]
      );
      if(!membership) return res.status(403).json({success:false,message:'Organization access denied'});
      sandbox=Boolean(membership.sandbox_flag);
    }
    const sandboxPayment = sandbox ? { is_demo: true } : { is_demo: Boolean(req.body.is_demo) };
    const result=await paymentPort.initiateDeposit({
      userId:req.user.id,amount,currency,email:req.body.email||req.user.email,orgId,
      ...sandboxPayment,idempotencyKey:req.get('Idempotency-Key')||null
    });
    await auditSecurity({actorId:req.user.id,action:'deposit_intent_created',targetType:'organization',targetId:orgId,details:{sandbox,is_demo:Boolean(result.is_demo)},req});
    res.json({success:true,...result});
  } catch(e){ console.error('Payment intent creation error:',e.message); res.status(e.status||500).json({success:false,message:e.status?e.message:'Failed to create payment intent'}); }
});

router.post('/deposit/verify', async (req,res)=>{
  try {
    const reference=String(req.body.reference||'').trim();
    if(!reference) return res.status(400).json({success:false,message:'reference is required'});
    const [[intent]]=await db.execute('SELECT user_id FROM payment_intents WHERE reference=?',[reference]);
    if(!intent || Number(intent.user_id)!==Number(req.user.id)) return res.status(403).json({success:false,message:'Payment reference does not belong to this account'});
    res.json({success:true,...await paymentPort.verify(reference)});
  } catch(e){ res.status(e.status||500).json({success:false,message:e.status?e.message:'Payment verification failed'}); }
});

// Paystack webhook: authentication is signature-based; accounting is delegated to
// the idempotent payment port so webhook + verify races cannot double-credit.
router.post('/paystack/webhook', async (req, res) => {
  if (!PAYSTACK_SECRET_KEY) return res.status(503).send('Paystack not configured');
  const hash=crypto.createHmac('sha512',PAYSTACK_SECRET_KEY).update(JSON.stringify(req.body)).digest('hex');
  if(hash!==req.headers['x-paystack-signature']) return res.status(401).send('Invalid signature');
  const event=req.body;
  if(event?.event==='charge.success'){
    const {reference,amount,currency}=event.data||{};
    try{
      const [[intent]]=await db.execute('SELECT user_id FROM payment_intents WHERE reference=?',[reference]);
      if(intent) await paymentPort.completePaystackDeposit({reference,userId:intent.user_id,amount:Number(amount)/100,currency,source:'webhook'});
    }catch(error){ console.error('Error processing Paystack deposit:',error.message); return res.status(500).send('Retry'); }
  }
  res.status(200).send('OK');
});

router.post('/paystack/verify', async (req,res) => {
  try {
    const reference=String(req.body.reference||'').trim();
    if(!reference) return res.status(400).json({success:false,message:'reference is required'});
    const [[intent]]=await db.execute('SELECT user_id FROM payment_intents WHERE reference=?',[reference]);
    if(!intent || Number(intent.user_id)!==Number(req.user.id)) return res.status(403).json({success:false,message:'Payment reference does not belong to this account'});
    const result=await paymentPort.verify(reference);
    res.json({success:true,...result,message:'Payment verified and processed'});
  } catch(error){ console.error('Paystack verification error:',error.message); res.status(error.status||500).json({success:false,message:error.status?error.message:'Verification failed'}); }
});

// =======================
// TRANSFER FUNCTIONALITY (Spendable to Withdrawable)
// =======================

// Direction is explicit, not assumed. The frontend has two distinct transfer
// actions — "move spendable funds to withdrawable" (PayNow's transfer tab)
// and "move withdrawable funds to spendable" (PayNow's standalone transfer
// button) — that used to hit this same endpoint with identical payloads, so
// the second one silently ran the first one's logic (debiting spendable
// instead of withdrawable). `direction` disambiguates them; it defaults to
// the original spendable->withdrawable behavior for any old client/tests
// that don't send it yet.
router.post('/transfer', async (req, res) => {
  const { amount, fromCurrency='USD', toCurrency='USD', direction='spendable_to_withdrawable' } = req.body || {};
  const userId=req.user.id; const value=Number(amount);
  if (!Number.isFinite(value) || value<=0) return res.status(400).json({success:false,message:'amount must be greater than 0'});
  if (!['spendable_to_withdrawable','withdrawable_to_spendable'].includes(direction)) return res.status(400).json({success:false,message:'Invalid transfer direction'});
  const sourceType=direction==='spendable_to_withdrawable'?'spendable':'withdrawable'; const destType=direction==='spendable_to_withdrawable'?'withdrawable':'spendable';
  try {
    const exchangeRate=await getExchangeRate(fromCurrency,toCurrency); const convertedAmount=value*exchangeRate; const conversionFee=String(fromCurrency).toUpperCase()!==String(toCurrency).toUpperCase()?value*0.01:0; const finalAmount=convertedAmount-conversionFee;
    const connection=await db.getConnection();
    try {
      await connection.beginTransaction();
      const [[sourceWallet]]=await connection.execute(`SELECT * FROM wallets WHERE user_id=? AND wallet_type=? AND currency=? AND status='active' FOR UPDATE`,[userId,sourceType,String(fromCurrency).toUpperCase()]);
      if(!sourceWallet || Number(sourceWallet.balance)<value){await connection.rollback();return res.status(400).json({success:false,message:`Insufficient ${sourceType} balance`});}
      let [[destWallet]]=await connection.execute(`SELECT * FROM wallets WHERE user_id=? AND wallet_type=? AND currency=? AND status='active' FOR UPDATE`,[userId,destType,String(toCurrency).toUpperCase()]);
      if(!destWallet){await connection.execute(`INSERT INTO wallets (user_id,wallet_type,currency,balance,status) VALUES (?,?,?,0,'active')`,[userId,destType,String(toCurrency).toUpperCase()]);[[destWallet]]=await connection.execute(`SELECT * FROM wallets WHERE user_id=? AND wallet_type=? AND currency=? AND status='active' FOR UPDATE`,[userId,destType,String(toCurrency).toUpperCase()]);}
      await transferWallets({fromWalletId:sourceWallet.id,toWalletId:destWallet.id,fromAmount:value,toAmount:finalAmount,currency:toCurrency,transactionType:'transfer',description:`Transfer from ${sourceType} to ${destType} account`,actorId:userId,reason:'wallet_transfer',originalAmount:value,originalCurrency:fromCurrency,exchangeRate,conversionFee,connection});
      await connection.commit(); return res.json({success:true,message:'Transfer successful',transferredAmount:finalAmount,conversionFee,exchangeRate});
    } catch(e){await connection.rollback();throw e;} finally{connection.release();}
  } catch(e){console.error('Transfer failed:',e.message);res.status(e.status||500).json({success:false,message:e.status?e.message:'Transfer failed'});}
});

// =======================
// WITHDRAWAL FUNCTIONALITY
// =======================

router.post('/withdraw', async (req,res)=>{
  const {amount,currency='USD',withdrawalMethodId}=req.body||{}; const value=Number(amount); const userId=req.user.id;
  if(!Number.isFinite(value)||value<=0)return res.status(400).json({success:false,message:'amount must be greater than 0'});
  try{
    const [[method]]=await db.execute('SELECT * FROM withdrawal_methods WHERE id=? AND user_id=? AND is_active=1',[withdrawalMethodId,userId]); if(!method)return res.status(404).json({success:false,message:'Withdrawal method not found'});
    const currencyUpper=String(currency).toUpperCase();
    const [[wallet]]=await db.execute(`SELECT * FROM wallets WHERE user_id=? AND wallet_type='withdrawable' AND currency=? AND status='active'`,[userId,currencyUpper]); if(!wallet||Number(wallet.balance)<value)return res.status(400).json({success:false,message:'Insufficient withdrawable balance'});
    const details=method.account_details?JSON.parse(method.account_details):{}; const fee=value*0.02; const net=value-fee; let gatewayTransactionId=null;
    if(method.method_type==='paypal'){
      if(!isPaypalPayoutsConfigured()||!details.email)return res.status(503).json({success:false,message:'PayPal payouts are not configured'});
      const accessToken=await getAccessToken(); const payout=await axios.post(`${BASE_URL}/v1/payments/payouts`,{sender_batch_header:{sender_batch_id:`payout_${userId}_${Date.now()}`},items:[{recipient_type:'EMAIL',amount:{value:net.toFixed(2),currency:currencyUpper},receiver:details.email}]},{headers:{Authorization:`Bearer ${accessToken}`}}); gatewayTransactionId=payout.data.batch_header?.payout_batch_id||`paypal_${Date.now()}`;
    } else if(method.method_type==='bank_transfer'){
      if(!isPaystackConfigured()||!details.account_number||!details.bank_code)return res.status(503).json({success:false,message:'Bank payout is not configured'});
      let recipientCode=details.recipient_code; if(!recipientCode){const rr=await axios.post(`${PAYSTACK_BASE_URL}/transferrecipient`,{type:'nuban',name:details.account_name||method.method_name,account_number:details.account_number,bank_code:details.bank_code,currency:currencyUpper},{headers:{Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`}});recipientCode=rr.data.data.recipient_code;await db.execute('UPDATE withdrawal_methods SET account_details=? WHERE id=?',[JSON.stringify({...details,recipient_code:recipientCode}),method.id]);}
      const tr=await axios.post(`${PAYSTACK_BASE_URL}/transfer`,{source:'balance',amount:Math.round(net*100),recipient:recipientCode,reason:`Withdrawal for user ${userId}`},{headers:{Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`}}); gatewayTransactionId=tr.data.data.transfer_code||tr.data.data.reference;
    } else return res.status(400).json({success:false,message:'Unsupported withdrawal method type'});
    const result=await debitUser({userId,walletType:'withdrawable',currency:currencyUpper,amount:value,transactionType:'withdrawal',description:`Withdrawal via ${method.method_type}`,actorId:userId,reason:'withdrawal',connection:null,paymentGateway:method.method_type,gatewayTransactionId});
    return res.json({success:true,message:'Withdrawal successful',netAmount:net,withdrawalFee:fee,gatewayTransactionId,result});
  }catch(e){console.error('Withdrawal failed:',e.message);return res.status(e.status||502).json({success:false,message:e.status?e.message:'Withdrawal failed'});}
});

// =======================
// EARNINGS MANAGEMENT (For runners)
// =======================

// Convert earnings to spendable balance (when errand is completed)
router.post('/convert-earnings', async (req, res) => {
  const { errandId, amount, currency = 'USD' } = req.body;
  const userId = req.user.id;
  
  try {
    // Verify errand completion and runner assignment
    const [errand] = await db.execute(
      `SELECT * FROM errands WHERE id = ? AND runner_id = ? AND status = 'completed'`,
      [errandId, userId]
    );
    
    if (!errand[0]) {
      return res.status(400).json({ success: false, message: 'Invalid errand or not completed' });
    }
    
    // Get or create spendable wallet
    let spendableWallet = await getUserWallet(userId, 'spendable', currency);
    if (!spendableWallet) {
      await createWallet(userId, 'spendable', currency);
      spendableWallet = await getUserWallet(userId, 'spendable', currency);
    }
    
    await creditUser({userId,amount:Number(amount),currency,walletType:'spendable',transactionType:'earning',description:`Earnings from errand #${errandId}`,actorId:userId,reason:`earning_conversion:${errandId}`});
    
    res.json({ success: true, message: 'Earnings converted to spendable balance', amount });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Earnings conversion failed', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  }
});

// =======================
// GIFT CARD REWARD SYSTEM
// =======================
// Users can turn part of their spendable balance into a gift card (a
// shareable code worth a fixed amount), which anyone can redeem back into
// their own spendable wallet. Both steps use a single held DB connection
// with row-level locking, so a card can never be redeemed twice even if two
// redemption requests land at the same moment.

const GIFT_CARD_PREFIX = 'GIFT';

const generateGiftCardCode = () => {
  const chunk = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${GIFT_CARD_PREFIX}-${chunk()}-${chunk()}-${chunk()}`;
};

// Create a gift card funded from the caller's own spendable balance
router.post('/giftcards/create', async (req, res) => {
  const { amount, currency = 'USD', message } = req.body;
  const userId = req.user.id;
  const upperCurrency = String(currency).toUpperCase();
  const numericAmount = parseFloat(amount);

  if (!numericAmount || numericAmount <= 0) {
    return res.status(400).json({ success: false, message: 'Enter a valid gift card amount' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Lock the spendable wallet row so a concurrent spend can't race this
    const [walletRows] = await connection.execute(
      `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = 'spendable' AND currency = ? AND status = 'active' FOR UPDATE`,
      [userId, upperCurrency]
    );
    const spendableWallet = walletRows[0];

    if (!spendableWallet || parseFloat(spendableWallet.balance) < numericAmount) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient spendable balance for this gift card amount' });
    }

    const giftDebit = await debitUser({userId,walletType:'spendable',currency:upperCurrency,amount:numericAmount,transactionType:'gift_card_issue',description:'Gift card created from spendable balance',actorId:userId,reason:'gift_card_issue',connection});

    // Generate a unique code (retry on the rare collision)
    let code;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateGiftCardCode();
      const [existing] = await connection.execute('SELECT id FROM gift_cards WHERE code = ?', [candidate]);
      if (existing.length === 0) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      await connection.rollback();
      return res.status(500).json({ success: false, message: 'Could not generate a unique gift card code, please try again' });
    }

    const [insertResult] = await connection.execute(
      `INSERT INTO gift_cards (code, created_by, amount, currency, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [code, userId, numericAmount, upperCurrency]
    );



    await connection.commit();

    res.json({
      success: true,
      message: 'Gift card created',
      giftCard: { id: insertResult.insertId, code, amount: numericAmount, currency: upperCurrency, status: 'active' }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Gift card creation failed:', error);
    res.status(500).json({ success: false, message: 'Failed to create gift card', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  } finally {
    connection.release();
  }
});

// Redeem a gift card code into the caller's spendable wallet
router.post('/giftcards/redeem', async (req, res) => {
  const { code } = req.body;
  const userId = req.user.id;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ success: false, message: 'Enter a gift card code' });
  }
  const normalizedCode = code.trim().toUpperCase();

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Lock the gift card row so two simultaneous redemptions can't both succeed
    const [cardRows] = await connection.execute(
      'SELECT * FROM gift_cards WHERE code = ? FOR UPDATE',
      [normalizedCode]
    );
    const card = cardRows[0];

    if (!card) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Gift card code not found' });
    }
    if (card.status !== 'active') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: `This gift card has already been ${card.status}` });
    }
    if (card.expires_at && new Date(card.expires_at) < new Date()) {
      await connection.execute(`UPDATE gift_cards SET status = 'expired' WHERE id = ?`, [card.id]);
      await connection.commit();
      return res.status(400).json({ success: false, message: 'This gift card has expired' });
    }

    // Get or create the redeemer's spendable wallet in the card's currency
    const [walletRows] = await connection.execute(
      `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = 'spendable' AND currency = ? AND status = 'active' FOR UPDATE`,
      [userId, card.currency]
    );
    let spendableWallet = walletRows[0];
    if (!spendableWallet) {
      const [created] = await connection.execute(
        `INSERT INTO wallets (user_id, wallet_type, currency, balance, status) VALUES (?, 'spendable', ?, 0.00, 'active')`,
        [userId, card.currency]
      );
      spendableWallet = { id: created.insertId, balance: 0 };
    }

    const giftCredit = await creditUser({userId,walletType:'spendable',currency:card.currency,amount:Number(card.amount),transactionType:'gift_card_redeem',description:`Gift card ${card.code} redeemed`,actorId:userId,reason:`gift_card_redeem:${card.id}`,connection});

    // Mark the card redeemed — this, combined with the row lock above, is
    // what guarantees a card can never be redeemed twice
    await connection.execute(
      `UPDATE gift_cards SET status = 'redeemed', redeemed_by = ?, redeemed_at = NOW() WHERE id = ?`,
      [userId, card.id]
    );



    await connection.commit();

    res.json({
      success: true,
      message: 'Gift card redeemed successfully',
      amount: parseFloat(card.amount),
      currency: card.currency
    });
  } catch (error) {
    await connection.rollback();
    console.error('Gift card redemption failed:', error);
    res.status(500).json({ success: false, message: 'Failed to redeem gift card', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  } finally {
    connection.release();
  }
});

// List gift cards the user has created and/or redeemed
router.get('/giftcards/mine', async (req, res) => {
  try {
    const userId = req.user.id;
    const [created] = await db.execute(
      'SELECT id, code, amount, currency, status, redeemed_by, redeemed_at, created_at FROM gift_cards WHERE created_by = ? ORDER BY created_at DESC',
      [userId]
    );
    const [redeemed] = await db.execute(
      'SELECT id, code, amount, currency, status, redeemed_at FROM gift_cards WHERE redeemed_by = ? ORDER BY redeemed_at DESC',
      [userId]
    );
    res.json({ success: true, created, redeemed });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch gift cards', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  }
});

// =======================
// TRANSACTION HISTORY
// =======================

router.get('/transactions', async (req, res) => {
  const { page = 1, limit = 20, type } = req.query;
  const userId = req.user.id;
  const offset = (page - 1) * limit;
  
  try {
    let query = `
      SELECT wt.*, 
             fw.wallet_type as from_wallet_type,
             tw.wallet_type as to_wallet_type
      FROM wallet_transactions wt
      LEFT JOIN wallets fw ON wt.from_wallet_id = fw.id
      LEFT JOIN wallets tw ON wt.to_wallet_id = tw.id
      WHERE (fw.user_id = ? OR tw.user_id = ?)
    `;
    
    const params = [userId, userId];
    
    if (type) {
      query += ' AND wt.transaction_type = ?';
      params.push(type);
    }
    
    query += ' ORDER BY wt.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const [transactions] = await db.execute(query, params);

    console.log(`Fetched ${transactions.length} transactions for user ${userId}`);

    res.json({ success: true, transactions, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch transactions', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  }
});

// DEBUG ROUTE: Check wallet status for runner
router.get('/debug/status', async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all wallet information
    const [wallets] = await db.execute(
      'SELECT * FROM wallets WHERE user_id = ? ORDER BY wallet_type',
      [userId]
    );
    
    // Get recent transactions
    const [transactions] = await db.execute(
      `SELECT wt.*, fw.wallet_type as from_wallet_type, tw.wallet_type as to_wallet_type
       FROM wallet_transactions wt
       LEFT JOIN wallets fw ON wt.from_wallet_id = fw.id
       LEFT JOIN wallets tw ON wt.to_wallet_id = tw.id
       WHERE (fw.user_id = ? OR tw.user_id = ?)
       ORDER BY wt.created_at DESC LIMIT 10`,
      [userId, userId]
    );
    
    // Get errands for this user
    const [errands] = await db.execute(
      'SELECT id, status, payment_status, amount FROM errands WHERE runner_id = ? ORDER BY created_at DESC LIMIT 5',
      [userId]
    );
    
    res.json({
      success: true,
      debug: {
        userId,
        wallets,
        recentTransactions: transactions,
        recentErrands: errands,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Debug failed', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  }
});

// Transfer from withdrawable to spendable (for runners who want to use earnings)
router.post('/transfer-to-spendable', async (req, res) => {
  const { amount, currency = 'USD' } = req.body;
  const userId = req.user.id;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Lock the withdrawable wallet row so a concurrent transfer/withdrawal
    // can't race this balance check
    const [walletRows] = await connection.execute(
      `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = 'withdrawable' AND currency = ? AND status = 'active' FOR UPDATE`,
      [userId, String(currency).toUpperCase()]
    );
    const withdrawableWallet = walletRows[0];

    if (!withdrawableWallet || parseFloat(withdrawableWallet.balance) < amount) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient withdrawable balance' });
    }

    // Get or create spendable wallet
    const [spendableRows] = await connection.execute(
      `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = 'spendable' AND currency = ? AND status = 'active' FOR UPDATE`,
      [userId, String(currency).toUpperCase()]
    );
    let spendableWallet = spendableRows[0];
    if (!spendableWallet) {
      const [created] = await connection.execute(
        `INSERT INTO wallets (user_id, wallet_type, currency, balance, status) VALUES (?, 'spendable', ?, 0.00, 'active')`,
        [userId, String(currency).toUpperCase()]
      );
      spendableWallet = { id: created.insertId, balance: 0 };
    }

    await transferWallets({fromWalletId:withdrawableWallet.id,toWalletId:spendableWallet.id,fromAmount:Number(amount),toAmount:Number(amount),currency,transactionType:'internal_transfer',description:'Transfer from withdrawable to spendable wallet',actorId:userId,reason:'internal_transfer',connection});

    await connection.commit();

    res.json({
      success: true,
      message: 'Transfer successful',
      transferredAmount: amount
    });
  } catch (error) {
    await connection.rollback();
    console.error('Transfer to spendable failed:', error);
    res.status(500).json({ success: false, message: 'Transfer failed', error: process.env.NODE_ENV === 'production' ? 'Request failed' : error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
