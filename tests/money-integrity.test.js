const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT=path.join(__dirname,'..');
const hasMysql=Boolean(process.env.MYSQL_HOST && process.env.MYSQL_PASSWORD);

function read(p){return fs.readFileSync(path.join(ROOT,p),'utf8');}

describe('financial integrity static guards',()=>{
  it('has additive money-integrity migration and reconciliation report',()=>{
    assert.ok(fs.existsSync(path.join(ROOT,'database/17-money-integrity.sql')));
    assert.ok(fs.existsSync(path.join(ROOT,'services/financialReconciliation.js')));
    assert.ok(read('routes/admin.routes.js').includes('/financial-reconciliation'));
  });
  it('keeps unique hold and referral/promo constraints',()=>{
    assert.match(read('database/08-money-state.sql'),/UNIQUE KEY uq_errand_hold/);
    assert.match(read('database/13-stage6-growth-risk.sql'),/UNIQUE KEY uq_referral_referee/);
    assert.match(read('database/13-stage6-growth-risk.sql'),/UNIQUE KEY uq_promo_user/);
  });
  it('uses row locks and transactions for wallet mutations',()=>{
    const src=read('services/financialService.js');
    assert.match(src,/BEGIN|beginTransaction/);
    assert.match(src,/FOR UPDATE/);
    assert.match(src,/ROLLBACK|rollback/);
  });
  it('uses payment intents for idempotent deposits',()=>{
    const src=read('services/paymentPort.js');
    assert.match(src,/payment_intents/);
    assert.match(src,/FOR UPDATE/);
    assert.match(src,/completePaystackDeposit/);
  });
  it('merchant idempotency record is created inside the errand transaction',()=>{
    const src=read('routes/merchant.routes.js');
    assert.match(src,/beginTransaction/);
    assert.match(src,/merchant_idempotency/);
    assert.match(src,/await conn\.commit/);
  });
  it('errandMoney remains the errand hold/release/refund authority',()=>{
    const src=read('services/errandMoney.js');
    for(const fn of ['createHold','releaseHold','refundHold','processDueReleases','processDueRefunds']) assert.match(src,new RegExp(`async function ${fn}`));
    assert.match(src,/status === 'released'/); assert.match(src,/status === 'refunded'/);
  });
});

describe('concurrency integration scenarios', { skip: !hasMysql && 'MYSQL_HOST/MYSQL_PASSWORD not configured' },()=>{
  it('requires a real isolated MySQL database to execute race scenarios', async()=>{
    assert.ok(hasMysql);
    const {pool}=require('../config/db.mysql');
    const {creditUser}=require('../services/financialService');
    const token=`integrity_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const email=`${token}@example.test`;
    let userId;
    try{
      const [u]=await pool.execute("INSERT INTO users (name,email,password) VALUES (?,?,?)",[token,email,'test']); userId=u.insertId;
      await Promise.all(Array.from({length:2},()=>creditUser({userId,amount:10,currency:'NGN',walletType:'spendable',transactionType:'deposit',reason:'concurrency_test',paymentGateway:'test',gatewayTransactionId:token,idempotencyKey:`test:${token}`})));
      const [[wallet]]=await pool.execute("SELECT balance FROM wallets WHERE user_id=? AND wallet_type='spendable' AND currency='NGN'",[userId]);
      const [[tx]]=await pool.execute("SELECT COUNT(*) n FROM wallet_transactions WHERE payment_gateway='test' AND gateway_transaction_id=?",[token]);
      assert.equal(Number(wallet.balance),10);
      assert.equal(Number(tx.n),1);
    } finally {
      if(userId){await pool.execute('DELETE FROM wallet_transactions WHERE payment_gateway=\'test\' AND gateway_transaction_id=?',[token]);await pool.execute('DELETE FROM wallets WHERE user_id=?',[userId]);await pool.execute('DELETE FROM users WHERE id=?',[userId]);}
      await pool.end();
    }
  });
});
