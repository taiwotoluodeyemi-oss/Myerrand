const { pool } = require('../config/db.mysql');

async function ensureWallet(conn, userId, walletType, currency) {
  const cur = String(currency).toUpperCase();
  await conn.execute(
    `INSERT INTO wallets (user_id,wallet_type,currency,balance,status) VALUES (?,?,?,0,'active')
     ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
    [userId, walletType, cur]
  );
  const [[wallet]] = await conn.execute(
    `SELECT * FROM wallets WHERE user_id=? AND wallet_type=? AND currency=? AND status='active' FOR UPDATE`,
    [userId, walletType, cur]
  );
  if (!wallet) throw new Error('Wallet not found');
  return wallet;
}

function validateAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0 || Math.round(value * 100) !== value * 100) {
    throw Object.assign(new Error('Invalid financial amount'), { status: 400 });
  }
  return value;
}

async function postWalletMutation({ fromWalletId=null, toWalletId=null, amount, currency, transactionType, description='', errandId=null, actorId=null, reason=null, isDemo=false, paymentGateway=null, gatewayTransactionId=null, connection=null, idempotencyKey=null }) {
  const own = !connection;
  const conn = connection || await pool.getConnection();
  try {
    if (own) await conn.beginTransaction();
    const value = validateAmount(amount);
    const cur = String(currency).toUpperCase();

    if (idempotencyKey) {
      const [[existing]] = await conn.execute('SELECT id, status, result_json FROM financial_operations WHERE operation_key=? FOR UPDATE', [idempotencyKey]);
      if (existing?.status === 'completed') {
        if (own) await conn.commit();
        return { ...(existing.result_json ? JSON.parse(existing.result_json) : {}), idempotent: true };
      }
      if (!existing) {
        await conn.execute(
          `INSERT INTO financial_operations (operation_key, operation_type, status, created_at) VALUES (?, 'wallet_mutation', 'processing', NOW())`,
          [idempotencyKey]
        );
      }
    }

    let from = null;
    if (fromWalletId) {
      [[from]] = await conn.execute('SELECT id,balance,currency FROM wallets WHERE id=? AND status=\'active\' FOR UPDATE',[fromWalletId]);
      if (!from || String(from.currency).toUpperCase() !== cur) throw Object.assign(new Error('Source wallet/currency mismatch'), { status: 409 });
      if (Number(from.balance) < value) throw Object.assign(new Error('Insufficient wallet balance'), { status: 409 });
    }
    if (toWalletId) {
      const [[to]] = await conn.execute('SELECT id,balance,currency FROM wallets WHERE id=? AND status=\'active\' FOR UPDATE',[toWalletId]);
      if (!to || String(to.currency).toUpperCase() !== cur) throw Object.assign(new Error('Destination wallet/currency mismatch'), { status: 409 });
    }

    if (fromWalletId) await conn.execute('UPDATE wallets SET balance=balance-?,updated_at=NOW() WHERE id=? AND balance>=?',[value,fromWalletId,value]);
    if (toWalletId) await conn.execute('UPDATE wallets SET balance=balance+?,updated_at=NOW() WHERE id=? AND status=\'active\'',[value,toWalletId]);

    const [txResult] = await conn.execute(
      `INSERT INTO wallet_transactions (from_wallet_id,to_wallet_id,errand_id,transaction_type,amount,currency,description,status,processed_at,actor_id,reason,is_demo,payment_gateway,gateway_transaction_id)
       VALUES (?,?,?,?,?,?,?,'completed',NOW(),?,?,?,?,?)`,
      [fromWalletId,toWalletId,errandId,transactionType,value,cur,description,actorId,reason,isDemo?1:0,paymentGateway,gatewayTransactionId]
    );
    const result = { success:true, amount:value, transactionId:txResult.insertId };
    if (idempotencyKey) {
      await conn.execute('UPDATE financial_operations SET status=\'completed\', result_json=?, completed_at=NOW() WHERE operation_key=?', [JSON.stringify(result), idempotencyKey]);
    }
    if (own) await conn.commit();
    return result;
  } catch (error) {
    if (own) await conn.rollback();
    throw error;
  } finally { if (own) conn.release(); }
}

async function creditUser(args) {
  const {userId,walletType='spendable',currency='NGN',amount,connection=null} = args;
  const own=!connection; const conn=connection||await pool.getConnection();
  try {
    if(own) await conn.beginTransaction();
    const wallet=await ensureWallet(conn,userId,walletType,currency);
    const result=await postWalletMutation({...args,toWalletId:wallet.id,connection:conn});
    if(own) await conn.commit();
    return {...result,walletId:wallet.id};
  } catch(e){if(own) await conn.rollback();throw e;} finally{if(own)conn.release();}
}

async function debitUser(args) {
  const {userId,walletType='spendable',currency='NGN',amount,connection=null} = args;
  const own=!connection; const conn=connection||await pool.getConnection();
  try {
    if(own) await conn.beginTransaction();
    const wallet=await ensureWallet(conn,userId,walletType,currency);
    const result=await postWalletMutation({...args,fromWalletId:wallet.id,connection:conn});
    if(own) await conn.commit();
    return {...result,walletId:wallet.id};
  } catch(e){if(own) await conn.rollback();throw e;} finally{if(own)conn.release();}
}

async function transferWallets({fromWalletId,toWalletId,fromAmount,toAmount,currency,transactionType='transfer',description='',actorId=null,reason=null,originalAmount=null,originalCurrency=null,exchangeRate=null,conversionFee=null,connection=null,idempotencyKey=null}) {
  const own=!connection; const conn=connection||await pool.getConnection();
  try {
    if(own) await conn.beginTransaction();
    const sourceId = Number(fromWalletId), destId = Number(toWalletId);
    const firstId = Math.min(sourceId, destId), secondId = Math.max(sourceId, destId);
    const [[first]] = await conn.execute('SELECT id,balance,currency FROM wallets WHERE id=? AND status=\'active\' FOR UPDATE',[firstId]);
    const [[second]] = await conn.execute('SELECT id,balance,currency FROM wallets WHERE id=? AND status=\'active\' FOR UPDATE',[secondId]);
    if(!first || !second) throw new Error('Wallet not found');
    const from = sourceId === firstId ? first : second;
    const to = sourceId === firstId ? second : first;
    const valueFrom = validateAmount(fromAmount);
    const valueTo = validateAmount(toAmount);
    if(String(from.currency).toUpperCase() !== String(currency).toUpperCase()) throw Object.assign(new Error('Source currency mismatch'),{status:409});
    if(Number(from.balance) < valueFrom) throw Object.assign(new Error('Insufficient wallet balance'),{status:409});
    await conn.execute('UPDATE wallets SET balance=balance-?,updated_at=NOW() WHERE id=? AND balance>=?',[valueFrom,sourceId,valueFrom]);
    await conn.execute('UPDATE wallets SET balance=balance+?,updated_at=NOW() WHERE id=?',[valueTo,destId]);
    const [tx] = await conn.execute(`INSERT INTO wallet_transactions (from_wallet_id,to_wallet_id,transaction_type,amount,currency,original_amount,original_currency,exchange_rate,conversion_fee,description,status,processed_at,actor_id,reason) VALUES (?,?,?,?,?,?,?,?,?,?,\'completed\',NOW(),?,?)`,[sourceId,destId,transactionType,valueTo,String(currency).toUpperCase(),originalAmount,originalCurrency,exchangeRate,conversionFee,description,actorId,reason]);
    if(own) await conn.commit(); return {success:true,transactionId:tx.insertId,amount:valueTo};
  } catch(e){if(own) await conn.rollback();throw e;} finally{if(own)conn.release();}
}

module.exports={ensureWallet,postWalletMutation,creditUser,debitUser,transferWallets,validateAmount};
