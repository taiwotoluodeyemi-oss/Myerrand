const axios = require('axios');
const crypto = require('crypto');
const { isPaystackConfigured } = require('../utils/payment-config');
const { pool } = require('../config/db.mysql');
const { creditUser, validateAmount } = require('./financialService');
const { isSupportedCurrency } = require('../utils/currencies');
const { recordPaymentFailure } = require('./observability');

function providerName(){ return isPaystackConfigured() ? 'paystack' : 'demo'; }
async function isSandboxOrg(orgId){ if(!orgId) return false; const [[r]]=await pool.execute('SELECT sandbox_flag FROM organizations WHERE id=?',[orgId]); return Boolean(r?.sandbox_flag); }

function normalizeCurrency(currency){ const cur=String(currency || 'NGN').trim().toUpperCase(); if(!isSupportedCurrency(cur)) throw Object.assign(new Error('Unsupported currency'),{status:400}); return cur; }
function makeReference(prefix,userId){ return `${prefix}_${userId}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`; }

async function createIntent({reference,userId,amount,currency,provider,isDemo=false,connection=null}){
  const conn=connection||pool;
  await conn.execute(`INSERT INTO payment_intents (reference,user_id,amount,currency,provider,status,is_demo) VALUES (?,?,?,?,?,'initialized',?)`,[reference,userId,amount,currency,provider,isDemo?1:0]);
}

async function demoDeposit({userId,amount,currency,idempotencyKey=null}){
  const value=validateAmount(amount); const cur=normalizeCurrency(currency); const reference=idempotencyKey ? `demo_${userId}_${crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex').slice(0,32)}` : makeReference('demo_dep',userId);
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [[existing]] = await conn.execute('SELECT * FROM payment_intents WHERE reference=? FOR UPDATE',[reference]);
    if(existing?.status==='completed'){await conn.commit(); return {provider:'demo',is_demo:true,reference,status:'completed',already_processed:true};}
    if(!existing) await createIntent({reference,userId,amount:value,currency:cur,provider:'demo',isDemo:true,connection:conn});
    else if(Number(existing.user_id)!==Number(userId)||Number(existing.amount)!==value||String(existing.currency)!==cur) throw Object.assign(new Error('Deposit reference conflict'),{status:409});
    const result=await creditUser({userId,amount:value,currency:cur,walletType:'spendable',transactionType:'deposit',description:'Demo deposit (no live payment provider configured)',reason:'demo_deposit',isDemo:true,paymentGateway:'demo',gatewayTransactionId:reference,connection:conn});
    await conn.execute(`UPDATE payment_intents SET status='completed',gateway_transaction_id=?,completed_at=NOW() WHERE reference=?`,[reference,reference]);
    await conn.commit(); return {provider:'demo',is_demo:true,reference,status:'completed',amount:value,currency:cur,transactionId:result.transactionId};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}

async function initiateDeposit({userId,amount,currency='NGN',email,orgId=null,is_demo=false,idempotencyKey=null}){
  const value=validateAmount(amount); const cur=normalizeCurrency(currency);
  if(is_demo || await isSandboxOrg(orgId) || providerName()==='demo') return demoDeposit({userId,amount:value,currency:cur,idempotencyKey});
  const reference=makeReference('dep',userId);
  await createIntent({reference,userId,amount:value,currency:cur,provider:'paystack',isDemo:false});
  try{
    const r=await axios.post('https://api.paystack.co/transaction/initialize',{email,amount:Math.round(value*100),currency:cur,reference,callback_url:`${process.env.FRONTEND_URL||''}/wallet/deposit/callback`,metadata:{user_id:userId,transaction_type:'deposit'}},{headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json'}});
    return {provider:'paystack',is_demo:false,reference:r.data.data.reference,authorization_url:r.data.data.authorization_url,access_code:r.data.data.access_code,status:'initialized'};
  }catch(e){ recordPaymentFailure(); await pool.execute(`UPDATE payment_intents SET status='failed' WHERE reference=? AND status='initialized'`,[reference]); throw e; }
}

async function completePaystackDeposit({reference,userId,amount,currency,source='verify'}){
  const value=validateAmount(amount); const cur=normalizeCurrency(currency); const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [[intent]]=await conn.execute('SELECT * FROM payment_intents WHERE reference=? FOR UPDATE',[reference]);
    if(!intent) throw Object.assign(new Error('Unknown payment reference'),{status:404});
    if(Number(intent.user_id)!==Number(userId)) throw Object.assign(new Error('Payment reference does not belong to this account'),{status:403});
    if(Number(intent.amount)!==value || String(intent.currency).toUpperCase()!==cur) throw Object.assign(new Error('Payment amount or currency mismatch'),{status:409});
    if(intent.status==='completed'){await conn.commit(); return {provider:'paystack',status:'completed',reference,amount:value,currency:cur,already_processed:true};}
    const result=await creditUser({userId,amount:value,currency:cur,walletType:'spendable',transactionType:'deposit',description:`Deposit via Paystack (${source})`,reason:`paystack_${source}_deposit`,paymentGateway:'paystack',gatewayTransactionId:reference,connection:conn});
    await conn.execute(`UPDATE payment_intents SET status='completed',gateway_transaction_id=?,completed_at=NOW() WHERE reference=?`,[reference,reference]);
    await conn.commit(); return {provider:'paystack',status:'completed',reference,amount:value,currency:cur,transactionId:result.transactionId};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
}

async function verify(reference){
  const ref=String(reference||'').trim(); if(!ref) throw Object.assign(new Error('Payment reference is required'),{status:400});
  if(ref.startsWith('demo_')) { const [[intent]]=await pool.execute('SELECT * FROM payment_intents WHERE reference=?',[ref]); return intent ? {provider:'demo',is_demo:true,reference:ref,status:intent.status,amount:Number(intent.amount),currency:intent.currency} : {provider:'demo',is_demo:true,reference:ref,status:'unknown'}; }
  if(!isPaystackConfigured()) throw Object.assign(new Error('Paystack is not configured'),{status:503});
  const [[intent]]=await pool.execute('SELECT * FROM payment_intents WHERE reference=?',[ref]);
  if(!intent) throw Object.assign(new Error('Unknown payment reference'),{status:404});
  if(intent.status==='completed') return {provider:'paystack',status:'completed',reference:ref,amount:Number(intent.amount),currency:intent.currency,already_processed:true};
  const r=await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`,{headers:{Authorization:`Bearer ${process.env.PAYSTACK_SECRET_KEY}`}});
  if(!r.data.status || r.data.data.status!=='success') return {provider:'paystack',status:'failed',reference:ref};
  const amount=Number(r.data.data.amount)/100; const currency=normalizeCurrency(r.data.data.currency); const userId=Number(intent.user_id);
  return completePaystackDeposit({reference:ref,userId,amount,currency,source:'verify'});
}

module.exports={initiateDeposit,verify,providerName,demoDeposit,isSandboxOrg,getUserWallet:async(userId,currency)=>{const [r]=await pool.execute("SELECT * FROM wallets WHERE user_id=? AND wallet_type='spendable' AND currency=? AND status='active'",[userId,normalizeCurrency(currency)]);return r[0]||null;},completePaystackDeposit};
