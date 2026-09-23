const { pool } = require('../config/db.mysql');

/**
 * Get or create a user's wallet by type and currency
 */
const getUserWallet = async (userId, walletType, currency = 'USD') => {
  const [wallet] = await pool.execute(
    `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = ? AND currency = ? AND status = 'active'`,
    [userId, walletType, currency]
  );
  
  if (wallet.length === 0) {
    // Create wallet if it doesn't exist
    await pool.execute(
      `INSERT INTO wallets (user_id, wallet_type, currency, balance, status) VALUES (?, ?, ?, 0.00, 'active')`,
      [userId, walletType, currency]
    );
    
    const [newWallet] = await pool.execute(
      `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = ? AND currency = ? AND status = 'active'`,
      [userId, walletType, currency]
    );
    return newWallet[0];
  }
  
  return wallet[0];
};

/**
 * Update wallet balance
 */
const updateWalletBalance = async (walletId, amount, connection = null) => {
  const db = connection || pool;
  await db.execute(
    'UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE id = ?',
    [amount, walletId]
  );
};

/**
 * Create a wallet transaction record
 */
const createWalletTransaction = async (fromWalletId, toWalletId, errandId, transactionType, amount, connection = null, description = '') => {
  const db = connection || pool;
  
  const [result] = await db.execute(
    `INSERT INTO wallet_transactions (
      from_wallet_id, to_wallet_id, errand_id, transaction_type, 
      amount, currency, description, status, processed_at
    ) VALUES (?, ?, ?, ?, ?, 'USD', ?, 'completed', NOW())`,
    [fromWalletId, toWalletId, errandId, transactionType, amount, description]
  );
  
  return result.insertId;
};

/**
 * Get user's total balance across all wallets
 */
const getUserTotalBalance = async (userId, currency = 'USD') => {
  const [result] = await pool.execute(
    `SELECT SUM(balance) as total_balance FROM wallets WHERE user_id = ? AND currency = ? AND status = 'active'`,
    [userId, currency]
  );
  
  return result[0]?.total_balance || 0;
};

/**
 * Get wallet balance by type
 */
const getWalletBalance = async (userId, walletType, currency = 'USD') => {
  const wallet = await getUserWallet(userId, walletType, currency);
  return wallet ? wallet.balance : 0;
};

/**
 * Process errand payment - move funds from client's spendable to escrow
 */
const processErrandPayment = async (clientId, errandId, amount, currency = 'USD') => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    // Get client's spendable wallet
    const clientSpendableWallet = await getUserWallet(clientId, 'spendable', currency);
    
    const spendableBal = parseFloat(clientSpendableWallet.balance) || 0;
    const payAmount = parseFloat(amount) || 0;
    if (spendableBal < payAmount) {
      throw new Error('Insufficient spendable balance');
    }
    amount = payAmount;
    
    // Get or create client's escrow wallet
    const clientEscrowWallet = await getUserWallet(clientId, 'escrow', currency);
    
    // Move funds from spendable to escrow
    await updateWalletBalance(clientSpendableWallet.id, -amount, connection);
    await updateWalletBalance(clientEscrowWallet.id, amount, connection);
    
    // Record the transaction
    await createWalletTransaction(
      clientSpendableWallet.id, 
      clientEscrowWallet.id, 
      errandId, 
      'escrow_hold', 
      amount, 
      connection,
      `Payment for errand #${errandId} held in escrow`
    );
    
    // Update errand payment status
    await connection.execute(
      `UPDATE errands SET payment_status = 'escrowed', is_paid = TRUE WHERE id = ?`,
      [errandId]
    );
    
    await connection.commit();
    return { success: true, message: 'Payment processed and held in escrow' };
    
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Release escrow funds to runner on errand completion.
 *
 * Escrow holds client_total. On completion only runner_payout is credited to
 * the runner's withdrawable balance; platform_fee + VAT remain with the
 * platform (debited from escrow but not paid out).
 *
 * @param {number} clientId
 * @param {number} runnerId
 * @param {number} errandId
 * @param {number} amount - legacy full amount when no breakdown (also default held)
 * @param {string} [currency='USD']
 * @param {{ runnerPayout?: number, heldAmount?: number }} [opts]
 */
const releaseEscrowFunds = async (clientId, runnerId, errandId, amount, currency = 'USD', opts = {}) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const heldAmount = parseFloat(opts.heldAmount != null ? opts.heldAmount : amount) || 0;
    const runnerPayout = parseFloat(opts.runnerPayout != null ? opts.runnerPayout : amount) || 0;

    if (heldAmount <= 0 || runnerPayout < 0 || runnerPayout > heldAmount + 0.001) {
      throw new Error(`Invalid release amounts: held=${heldAmount}, runnerPayout=${runnerPayout}`);
    }

    console.log(`[DEBUG] releaseEscrowFunds called with:`, {
      clientId, runnerId, errandId, heldAmount, runnerPayout, currency
    });

    const clientEscrowWallet = await getUserWallet(clientId, 'escrow', currency);
    const runnerWithdrawableWallet = await getUserWallet(runnerId, 'withdrawable', currency);

    const escrowBal = parseFloat(clientEscrowWallet.balance) || 0;
    if (escrowBal < heldAmount) {
      throw new Error(`Insufficient escrow balance. Required: ${heldAmount}, Available: ${escrowBal}`);
    }

    // Debit full client_total from escrow; credit only runner_payout to runner.
    // Difference (platform_fee + VAT) stays with the platform.
    await updateWalletBalance(clientEscrowWallet.id, -heldAmount, connection);
    if (runnerPayout > 0) {
      await updateWalletBalance(runnerWithdrawableWallet.id, runnerPayout, connection);
    }

    const transactionId = await createWalletTransaction(
      clientEscrowWallet.id,
      runnerWithdrawableWallet.id,
      errandId,
      'escrow_release',
      runnerPayout,
      connection,
      `Runner payout ${runnerPayout} for completed errand #${errandId} (held ${heldAmount})`
    );

    await connection.execute(
      `UPDATE errands SET payment_status = 'released' WHERE id = ?`,
      [errandId]
    );

    await connection.commit();
    console.log(`[DEBUG] releaseEscrowFunds completed successfully (txn ${transactionId})`);
    return {
      success: true,
      message: 'Escrow funds released to runner',
      runner_payout: runnerPayout,
      held_amount: heldAmount,
      platform_retained: Math.round((heldAmount - runnerPayout + Number.EPSILON) * 100) / 100,
    };
  } catch (error) {
    console.error(`[ERROR] releaseEscrowFunds failed:`, error);
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Get all wallet balances for a user
 */
const getAllWalletBalances = async (userId, currency = 'USD') => {
  const [wallets] = await pool.execute(
    `SELECT wallet_type, balance FROM wallets WHERE user_id = ? AND currency = ? AND status = 'active'`,
    [userId, currency]
  );
  
  const balances = {
    spendable: 0,
    withdrawable: 0,
    escrow: 0,
    total: 0
  };
  
  // BUGFIX: mysql2 returns DECIMAL columns as strings (e.g. "50.00"), not
  // numbers. Without parseFloat here, `balances.total += wallet.balance`
  // silently did STRING CONCATENATION instead of addition (e.g. "50.00" +
  // "20.00" became "50.0020.00"), and the frontend's `.toFixed(2)` calls on
  // these string balances threw a TypeError, crashing the balance display.
  wallets.forEach(wallet => {
    const numericBalance = parseFloat(wallet.balance) || 0;
    balances[wallet.wallet_type] = numericBalance;
    balances.total += numericBalance;
  });
  
  return balances;
};

module.exports = {
  getUserWallet,
  updateWalletBalance,
  createWalletTransaction,
  getUserTotalBalance,
  getWalletBalance,
  processErrandPayment,
  releaseEscrowFunds,
  getAllWalletBalances
};
