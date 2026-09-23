const { pool } = require('../config/db.mysql');

/**
 * Get or create a user's wallet by type and currency
 */
const getUserWallet = async (userId, walletType, currency = 'USD') => {
  const [wallet] = await pool.execute(
    'SELECT * FROM wallets WHERE user_id = ? AND wallet_type = ? AND currency = ? AND status = "active"',
    [userId, walletType, currency]
  );
  
  if (wallet.length === 0) {
    // Create wallet if it doesn't exist
    await pool.execute(
      'INSERT INTO wallets (user_id, wallet_type, currency, balance, status) VALUES (?, ?, ?, 0.00, "active")',
      [userId, walletType, currency]
    );
    
    const [newWallet] = await pool.execute(
      'SELECT * FROM wallets WHERE user_id = ? AND wallet_type = ? AND currency = ? AND status = "active"',
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
    'SELECT SUM(balance) as total_balance FROM wallets WHERE user_id = ? AND currency = ? AND status = "active"',
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
    
    if (clientSpendableWallet.balance < amount) {
      throw new Error('Insufficient spendable balance');
    }
    
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
      'UPDATE errands SET payment_status = "escrowed", is_paid = TRUE WHERE id = ?',
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
 * Release escrow funds to runner on errand completion
 */
const releaseEscrowFunds = async (clientId, runnerId, errandId, amount, currency = 'USD') => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    console.log(`[DEBUG] releaseEscrowFunds called with:`, {
      clientId, runnerId, errandId, amount, currency
    });
    
    // Get wallets
    const clientEscrowWallet = await getUserWallet(clientId, 'escrow', currency);
    const runnerWithdrawableWallet = await getUserWallet(runnerId, 'withdrawable', currency);
    
    console.log(`[DEBUG] Retrieved wallets:`, {
      clientEscrowWallet: { id: clientEscrowWallet.id, balance: clientEscrowWallet.balance },
      runnerWithdrawableWallet: { id: runnerWithdrawableWallet.id, balance: runnerWithdrawableWallet.balance }
    });
    
    if (clientEscrowWallet.balance < amount) {
      throw new Error(`Insufficient escrow balance. Required: ${amount}, Available: ${clientEscrowWallet.balance}`);
    }
    
    // Move funds from client's escrow to runner's withdrawable
    console.log(`[DEBUG] Updating wallet balances...`);
    await updateWalletBalance(clientEscrowWallet.id, -amount, connection);
    await updateWalletBalance(runnerWithdrawableWallet.id, amount, connection);
    
    // Record the transaction
    console.log(`[DEBUG] Creating wallet transaction...`);
    const transactionId = await createWalletTransaction(
      clientEscrowWallet.id, 
      runnerWithdrawableWallet.id, 
      errandId, 
      'escrow_release', 
      amount, 
      connection,
      `Payment released for completed errand #${errandId}`
    );
    
    console.log(`[DEBUG] Transaction created with ID: ${transactionId}`);
    
    // Update errand payment status
    console.log(`[DEBUG] Updating errand payment status...`);
    await connection.execute(
      'UPDATE errands SET payment_status = "released" WHERE id = ?',
      [errandId]
    );
    
    await connection.commit();
    console.log(`[DEBUG] releaseEscrowFunds completed successfully`);
    return { success: true, message: 'Escrow funds released to runner' };
    
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
    'SELECT wallet_type, balance FROM wallets WHERE user_id = ? AND currency = ? AND status = "active"',
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
