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
const updateWalletBalance = async () => {
  throw new Error('Direct wallet balance mutation is disabled. Use services/financialService.js or services/errandMoney.js.');
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
 * Compatibility wrappers. Errand money movement now lives exclusively in
 * services/errandMoney.js; these names remain for older callers during the
 * migration window.
 */
const processErrandPayment = async (clientId, errandId, amount, currency = 'USD', isDemo = false) => {
  const { createHold } = require('../services/errandMoney');
  return createHold(errandId, clientId, currency, isDemo);
};

const releaseEscrowFunds = async (clientId, runnerId, errandId) => {
  const { releaseHold } = require('../services/errandMoney');
  return releaseHold(errandId, null, 'Compatibility release request');
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
