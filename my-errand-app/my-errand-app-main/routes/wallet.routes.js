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
    'SELECT * FROM wallets WHERE user_id = ? AND wallet_type = ? AND currency = ? AND status = "active"',
    [userId, walletType, currency]
  );
  return wallet[0] || null;
};

// Create wallet if it doesn't exist
const createWallet = async (userId, walletType, currency = 'USD') => {
  const [result] = await db.execute(
    'INSERT INTO wallets (user_id, wallet_type, currency, balance, status) VALUES (?, ?, ?, 0.00, "active")',
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
    res.status(500).json({ success: false, message: 'Failed to fetch currencies', error: error.message });
  }
});

// Get exchange rate
router.get('/exchange-rate', async (req, res) => {
  try {
    const { from = 'USD', to = 'USD' } = req.query;
    const rate = await getExchangeRate(from.toUpperCase(), to.toUpperCase());
    res.json({ success: true, from: from.toUpperCase(), to: to.toUpperCase(), rate });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch exchange rate', error: error.message });
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
    res.status(500).json({ success: false, message: 'Conversion failed', error: error.message });
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
      'SELECT wallet_type, currency, balance, status FROM wallets WHERE user_id = ? AND currency = ? AND status = "active"',
      [userId, currency]
    );

    // Aggregate spendable + withdrawable + escrow balances for this currency only
    const aggregatedBalance = wallets.reduce((acc, wallet) => acc + parseFloat(wallet.balance), 0);

    res.json({ success: true, wallets, totalBalance: aggregatedBalance, currency });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch wallets', error: error.message });
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
    res.status(500).json({ success: false, message: 'Failed to fetch balance summary', error: error.message });
  }
});

// =======================
// DEPOSIT FUNCTIONALITY
// =======================

// Create deposit intent (Step 1: Generate payment intent)
router.post('/deposit/create-intent', async (req, res) => {
  const { amount, currency = 'USD', paymentMethod = 'paystack', email } = req.body;
  const userId = req.user.id;
  const depositAmount = parseFloat(amount);

  try {
    if (!depositAmount || depositAmount <= 0) {
      return res.status(400).json({ success: false, message: 'amount must be greater than 0' });
    }

    if (paymentMethod === 'paystack') {
      // Dev-mode fallback: this server has no real Paystack credentials
      // configured and isn't running in production, so there's no gateway
      // to actually charge. Rather than generate a fake authorization_url
      // and have the frontend do window.location.href = url — a full-page
      // navigation that does NOT send the Authorization header, so a later
      // "verify" call on that reference would 401 — we credit the wallet
      // synchronously, right here, inside this already-authenticated
      // request. No redirect, no second round trip, nothing to lose the
      // token. This branch stops being reachable the moment real Paystack
      // keys are added to .env (isPaystackConfigured() flips true), so it
      // never runs in a properly configured environment.
      if (!isPaystackConfigured() && process.env.NODE_ENV !== 'production') {
        let wallet = await getUserWallet(userId, 'spendable', currency.toUpperCase());
        if (!wallet) {
          await createWallet(userId, 'spendable', currency.toUpperCase());
          wallet = await getUserWallet(userId, 'spendable', currency.toUpperCase());
        }

        const reference = `dev_dep_${Date.now()}_${userId}`;
        await db.execute(
          'UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE id = ?',
          [depositAmount, wallet.id]
        );
        await db.execute(
          `INSERT INTO wallet_transactions (
            to_wallet_id, transaction_type, amount, currency, description,
            payment_gateway, gateway_transaction_id, status, processed_at
          ) VALUES (?, 'deposit', ?, ?, ?, 'dev_mode', ?, 'completed', NOW())`,
          [wallet.id, depositAmount, currency.toUpperCase(), 'Dev-mode deposit (no Paystack credentials configured)', reference]
        );

        console.warn(`[DEV MODE] Credited ${depositAmount} ${currency.toUpperCase()} to user ${userId}'s spendable wallet without a real payment — set PAYSTACK_SECRET_KEY / PAYSTACK_PUBLIC_KEY to disable this.`);

        return res.json({
          success: true,
          devMode: true,
          message: `Dev mode: $${depositAmount.toFixed(2)} ${currency.toUpperCase()} added to your spendable wallet (no real payment was made, since Paystack isn't configured on this server).`,
          reference
        });
      }

      // Initialize Paystack transaction
      const paystackResponse = await axios.post(
        `${PAYSTACK_BASE_URL}/transaction/initialize`,
        {
          email: email || req.user.email,
          amount: Math.round(depositAmount * 100), // Paystack expects amount in kobo (for NGN)
          currency: currency.toUpperCase(),
          reference: `dep_${Date.now()}_${userId}`,
          callback_url: `${process.env.FRONTEND_URL}/wallet/deposit/callback`,
          metadata: {
            user_id: userId,
            transaction_type: 'deposit'
          }
        },
        {
          headers: {
            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (paystackResponse.data.status) {
        res.json({
          success: true,
          authorization_url: paystackResponse.data.data.authorization_url,
          access_code: paystackResponse.data.data.access_code,
          reference: paystackResponse.data.data.reference
        });
      } else {
        res.status(400).json({ success: false, message: 'Failed to initialize Paystack transaction' });
      }
    } else {
      res.status(400).json({ success: false, message: 'Unsupported payment method' });
    }
  } catch (error) {
    console.error('Payment intent creation error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Failed to create payment intent', error: error.message });
  }
});

// Paystack webhook handler
router.post('/paystack/webhook', async (req, res) => {
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(503).send('Paystack not configured');
  }
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');
  if (hash !== req.headers['x-paystack-signature']) {
    console.warn('Paystack webhook: invalid signature');
    return res.status(401).send('Invalid signature');
  }

  const event = req.body;
  if (event && event.event === 'charge.success') {
    const { reference, amount, currency } = event.data || {};
    const referenceMatch = reference && String(reference).match(/dep_(\d+)_(\d+)/);
    if (referenceMatch) {
      const userId = parseInt(referenceMatch[2], 10);
      const finalAmount = amount / 100;
      try {
        let wallet = await getUserWallet(userId, 'spendable', currency);
        if (!wallet) {
          await createWallet(userId, 'spendable', currency);
          wallet = await getUserWallet(userId, 'spendable', currency);
        }
        await db.execute('UPDATE wallets SET balance = balance + ? WHERE id = ?', [finalAmount, wallet.id]);
        await db.execute(
          `INSERT INTO wallet_transactions (
            to_wallet_id, transaction_type, amount, currency, description,
            payment_gateway, gateway_transaction_id, status, processed_at
          ) VALUES (?, 'deposit', ?, ?, ?, 'paystack', ?, 'completed', NOW())`,
          [wallet.id, finalAmount, currency, 'Deposit via Paystack', reference]
        );
        console.log(`Paystack deposit processed: ${finalAmount} ${currency} for user ${userId}`);
      } catch (error) {
        console.error('Error processing Paystack deposit:', error);
      }
    }
  }
  res.status(200).send('OK');
});

// Verify Paystack transaction
router.post('/paystack/verify', async (req, res) => {
  const { reference } = req.body;
  
  try {
    const response = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
        }
      }
    );
    
    if (response.data.status && response.data.data.status === 'success') {
      const { amount, currency } = response.data.data;
      const finalAmount = amount / 100;
      
      // Extract user ID from reference
      const referenceMatch = reference.match(/dep_(\d+)_(\d+)/);
      if (referenceMatch) {
        const userId = parseInt(referenceMatch[2]);
        
        // Get or create spendable wallet
        let wallet = await getUserWallet(userId, 'spendable', currency);
        if (!wallet) {
          await createWallet(userId, 'spendable', currency);
          wallet = await getUserWallet(userId, 'spendable', currency);
        }
        
        // Check if transaction already processed
        const [existingTx] = await db.execute(
          'SELECT id FROM wallet_transactions WHERE gateway_transaction_id = ? AND payment_gateway = "paystack"',
          [reference]
        );
        
        if (existingTx.length === 0) {
          // Update wallet balance
          await db.execute(
            'UPDATE wallets SET balance = balance + ? WHERE id = ?',
            [finalAmount, wallet.id]
          );
          
          // Record transaction
          await db.execute(
            `INSERT INTO wallet_transactions (
              to_wallet_id, transaction_type, amount, currency, description, 
              payment_gateway, gateway_transaction_id, status, processed_at
            ) VALUES (?, 'deposit', ?, ?, ?, 'paystack', ?, 'completed', NOW())`,
            [wallet.id, finalAmount, currency, 'Deposit via Paystack', reference]
          );
        }
        
        res.json({ success: true, message: 'Payment verified and processed', amount: finalAmount, currency });
      } else {
        res.status(400).json({ success: false, message: 'Invalid transaction reference' });
      }
    } else {
      res.status(400).json({ success: false, message: 'Transaction verification failed' });
    }
  } catch (error) {
    console.error('Paystack verification error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Verification failed', error: error.message });
  }
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
  const {
    amount,
    fromCurrency = 'USD',
    toCurrency = 'USD',
    direction = 'spendable_to_withdrawable'
  } = req.body;
  const userId = req.user.id;

  if (!['spendable_to_withdrawable', 'withdrawable_to_spendable'].includes(direction)) {
    return res.status(400).json({ success: false, message: 'Invalid transfer direction' });
  }

  const sourceType = direction === 'spendable_to_withdrawable' ? 'spendable' : 'withdrawable';
  const destType = direction === 'spendable_to_withdrawable' ? 'withdrawable' : 'spendable';

  try {
    // Quick unlocked pre-check purely to fail fast on obviously-insufficient
    // balance before doing an exchange-rate lookup (which may hit a live
    // API). The authoritative check happens below, on the locked row.
    const sourceWalletPrecheck = await getUserWallet(userId, sourceType, fromCurrency);
    if (!sourceWalletPrecheck || sourceWalletPrecheck.balance < amount) {
      return res.status(400).json({ success: false, message: `Insufficient ${sourceType} balance` });
    }

    // Get or create destination wallet
    let destWallet = await getUserWallet(userId, destType, toCurrency);
    if (!destWallet) {
      await createWallet(userId, destType, toCurrency);
      destWallet = await getUserWallet(userId, destType, toCurrency);
    }
    
    // Calculate conversion if needed (done before the DB transaction since
    // this can call out to a live exchange-rate API — we don't want to hold
    // a row lock open for that)
    const exchangeRate = await getExchangeRate(fromCurrency, toCurrency);
    const convertedAmount = amount * exchangeRate;
    const conversionFee = fromCurrency !== toCurrency ? amount * 0.01 : 0; // 1% conversion fee
    const finalAmount = convertedAmount - conversionFee;
    
    // Start transaction on a dedicated pooled connection (the pool itself
    // has no beginTransaction/commit/rollback — only a checked-out
    // connection does; see getUserWallet-adjacent usages elsewhere in this
    // file for the same pattern).
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Re-fetch and lock the source wallet row so a concurrent transfer or
      // withdrawal can't race this balance check
      const [sourceRows] = await connection.execute(
        'SELECT * FROM wallets WHERE user_id = ? AND wallet_type = ? AND currency = ? AND status = "active" FOR UPDATE',
        [userId, sourceType, String(fromCurrency).toUpperCase()]
      );
      const sourceWallet = sourceRows[0];
      if (!sourceWallet || parseFloat(sourceWallet.balance) < amount) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: `Insufficient ${sourceType} balance` });
      }

      // Deduct from source wallet
      await connection.execute(
        'UPDATE wallets SET balance = balance - ? WHERE id = ?',
        [amount, sourceWallet.id]
      );

      console.log(`Transfer: -${amount} ${fromCurrency} from wallet ${sourceWallet.id} (${sourceType}) for user ${userId}`);

      // Add to destination wallet
      await connection.execute(
        'UPDATE wallets SET balance = balance + ? WHERE id = ?',
        [finalAmount, destWallet.id]
      );

      console.log(`Transfer: +${finalAmount} ${toCurrency} to wallet ${destWallet.id} (${destType}) for user ${userId}`);
      
      // Record transfer transaction
      await connection.execute(
        `INSERT INTO wallet_transactions (
          from_wallet_id, to_wallet_id, transaction_type, amount, currency,
          original_amount, original_currency, exchange_rate, conversion_fee,
          description, status, processed_at
        ) VALUES (?, ?, 'transfer', ?, ?, ?, ?, ?, ?, ?, 'completed', NOW())`,
        [
          sourceWallet.id, destWallet.id, finalAmount, toCurrency,
          amount, fromCurrency, exchangeRate, conversionFee,
          `Transfer from ${sourceType} to ${destType} account`
        ]
      );
      
      await connection.commit();
      
      res.json({ 
        success: true, 
        message: 'Transfer successful',
        transferredAmount: finalAmount,
        conversionFee,
        exchangeRate
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Transfer failed:', error);
    res.status(500).json({ success: false, message: 'Transfer failed', error: error.message });
  }
});

// =======================
// WITHDRAWAL FUNCTIONALITY
// =======================

// Get user's withdrawal methods
router.get('/withdrawal-methods', async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [methods] = await db.execute(
      'SELECT id, method_type, method_name, is_verified, is_default FROM withdrawal_methods WHERE user_id = ? AND is_active = 1',
      [userId]
    );
    
    res.json({ success: true, methods });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch withdrawal methods', error: error.message });
  }
});

// Add withdrawal method
router.post('/withdrawal-methods', async (req, res) => {
  const { methodType, methodName, accountDetails } = req.body;
  const userId = req.user.id;
  
  try {
    const [result] = await db.execute(
      'INSERT INTO withdrawal_methods (user_id, method_type, method_name, account_details) VALUES (?, ?, ?, ?)',
      [userId, methodType, methodName, JSON.stringify(accountDetails)]
    );
    
    res.json({ success: true, message: 'Withdrawal method added', methodId: result.insertId });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to add withdrawal method', error: error.message });
  }
});

// Process withdrawal
router.post('/withdraw', async (req, res) => {
  const { amount, currency = 'USD', withdrawalMethodId } = req.body;
  const userId = req.user.id;

  // Everything from here on happens inside one held connection: we lock the
  // withdrawable wallet row BEFORE calling any real payout provider, so two
  // concurrent withdrawal requests can't both pass the balance check and
  // both send real money out. The lock is held across the payout call and
  // only released once the deduction is committed (or the whole thing is
  // rolled back on failure).
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [walletRows] = await connection.execute(
      'SELECT * FROM wallets WHERE user_id = ? AND wallet_type = "withdrawable" AND currency = ? AND status = "active" FOR UPDATE',
      [userId, String(currency).toUpperCase()]
    );
    const withdrawableWallet = walletRows[0];

    if (!withdrawableWallet || parseFloat(withdrawableWallet.balance) < amount) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient withdrawable balance' });
    }

    // Get withdrawal method
    const [method] = await connection.execute(
      'SELECT * FROM withdrawal_methods WHERE id = ? AND user_id = ? AND is_active = 1',
      [withdrawalMethodId, userId]
    );

    if (!method[0]) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Withdrawal method not found' });
    }

    const withdrawalMethod = method[0];

    // Calculate withdrawal fee (example: 2% fee)
    const withdrawalFee = amount * 0.02;
    const netAmount = amount - withdrawalFee;

    // Process withdrawal based on method type. Each branch only goes "live"
    // once the matching provider credentials are set in .env — otherwise we
    // fail loudly and clearly instead of pretending the payout happened.
    let withdrawalSuccessful = false;
    let gatewayTransactionId = null;
    let accountDetails = {};
    try {
      accountDetails = withdrawalMethod.account_details ? JSON.parse(withdrawalMethod.account_details) : {};
    } catch (e) {
      accountDetails = {};
    }

    if (withdrawalMethod.method_type === 'paypal') {
      if (!isPaypalPayoutsConfigured()) {
        await connection.rollback();
        return res.status(503).json({
          success: false,
          message: 'PayPal payouts are not set up yet. Add PAYPAL_CLIENT_ID, PAYPAL_SECRET and set PAYPAL_PAYOUTS_ENABLED=true in the server .env to activate this method.'
        });
      }
      if (!accountDetails.email) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'This PayPal withdrawal method is missing a payout email' });
      }

      try {
        const accessToken = await getAccessToken();
        const payoutResponse = await axios.post(
          `${BASE_URL}/v1/payments/payouts`,
          {
            sender_batch_header: {
              sender_batch_id: `payout_${userId}_${Date.now()}`,
              email_subject: 'You have a withdrawal from My Errand'
            },
            items: [{
              recipient_type: 'EMAIL',
              amount: { value: netAmount.toFixed(2), currency },
              receiver: accountDetails.email,
              note: `Withdrawal payout for user ${userId}`
            }]
          },
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        withdrawalSuccessful = true;
        gatewayTransactionId = payoutResponse.data.batch_header?.payout_batch_id || `paypal_${Date.now()}`;
      } catch (payoutError) {
        console.error('PayPal payout failed:', payoutError.response?.data || payoutError.message);
        await connection.rollback();
        return res.status(502).json({ success: false, message: 'PayPal payout failed', error: payoutError.response?.data?.message || payoutError.message });
      }
    } else if (withdrawalMethod.method_type === 'bank_transfer') {
      if (!isPaystackConfigured()) {
        await connection.rollback();
        return res.status(503).json({
          success: false,
          message: 'Bank transfer payouts are not set up yet. Add PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY to the server .env to activate this method.'
        });
      }
      if (!accountDetails.account_number || !accountDetails.bank_code) {
        await connection.rollback();
        return res.status(400).json({ success: false, message: 'This bank withdrawal method is missing an account number or bank code' });
      }

      try {
        // Step 1: create (or reuse) a transfer recipient
        let recipientCode = accountDetails.recipient_code;
        if (!recipientCode) {
          const recipientResponse = await axios.post(
            `${PAYSTACK_BASE_URL}/transferrecipient`,
            {
              type: 'nuban',
              name: accountDetails.account_name || withdrawalMethod.method_name,
              account_number: accountDetails.account_number,
              bank_code: accountDetails.bank_code,
              currency
            },
            { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } }
          );
          recipientCode = recipientResponse.data.data.recipient_code;
          // Cache it so future withdrawals from this method skip recipient creation
          await connection.execute(
            'UPDATE withdrawal_methods SET account_details = ? WHERE id = ?',
            [JSON.stringify({ ...accountDetails, recipient_code: recipientCode }), withdrawalMethod.id]
          );
        }

        // Step 2: initiate the transfer
        const transferResponse = await axios.post(
          `${PAYSTACK_BASE_URL}/transfer`,
          {
            source: 'balance',
            amount: Math.round(netAmount * 100), // kobo
            recipient: recipientCode,
            reason: `Withdrawal for user ${userId}`
          },
          { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' } }
        );
        withdrawalSuccessful = true;
        gatewayTransactionId = transferResponse.data.data.transfer_code || transferResponse.data.data.reference;
      } catch (transferError) {
        console.error('Paystack transfer failed:', transferError.response?.data || transferError.message);
        await connection.rollback();
        return res.status(502).json({ success: false, message: 'Bank transfer payout failed', error: transferError.response?.data?.message || transferError.message });
      }
    } else {
      await connection.rollback();
      return res.status(400).json({ success: false, message: `Unsupported withdrawal method type: ${withdrawalMethod.method_type}` });
    }

    if (withdrawalSuccessful) {
      // Deduct from withdrawable wallet (row is still locked from above)
      await connection.execute(
        'UPDATE wallets SET balance = balance - ? WHERE id = ?',
        [amount, withdrawableWallet.id]
      );

      console.log(`Withdrawal: -${amount} ${currency} from wallet ${withdrawableWallet.id} for user ${userId}`);

      // Record withdrawal transaction
      await connection.execute(
        `INSERT INTO wallet_transactions (
          from_wallet_id, transaction_type, amount, currency, description,
          payment_gateway, gateway_transaction_id, gateway_fee, status, processed_at
        ) VALUES (?, 'withdrawal', ?, ?, ?, ?, ?, ?, 'completed', NOW())`,
        [
          withdrawableWallet.id, netAmount, currency,
          `Withdrawal via ${withdrawalMethod.method_type}`,
          withdrawalMethod.method_type, gatewayTransactionId, withdrawalFee
        ]
      );

      await connection.commit();

      res.json({
        success: true,
        message: 'Withdrawal successful',
        netAmount,
        withdrawalFee,
        gatewayTransactionId
      });
    } else {
      // Should be unreachable (every branch above either sets
      // withdrawalSuccessful=true or returns early), but guard anyway.
      await connection.rollback();
      res.status(500).json({ success: false, message: 'Withdrawal processing failed' });
    }
  } catch (error) {
    console.error('Withdrawal failed:', error);
    if (connection) {
      try { await connection.rollback(); } catch (rollbackErr) { /* connection may already be broken */ }
    }
    res.status(500).json({ success: false, message: 'Withdrawal failed', error: error.message });
  } finally {
    if (connection) connection.release();
  }
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
      'SELECT * FROM errands WHERE id = ? AND runner_id = ? AND status = "completed"',
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
    
    // Add earnings to spendable wallet
    await db.execute(
      'UPDATE wallets SET balance = balance + ? WHERE id = ?',
      [amount, spendableWallet.id]
    );
    
    // Record earning transaction
    await db.execute(
      `INSERT INTO wallet_transactions (
        to_wallet_id, transaction_type, amount, currency, errand_id,
        description, status, processed_at
      ) VALUES (?, 'earning', ?, ?, ?, ?, 'completed', NOW())`,
      [spendableWallet.id, amount, currency, errandId, `Earnings from errand #${errandId}`]
    );
    
    res.json({ success: true, message: 'Earnings converted to spendable balance', amount });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Earnings conversion failed', error: error.message });
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
      'SELECT * FROM wallets WHERE user_id = ? AND wallet_type = "spendable" AND currency = ? AND status = "active" FOR UPDATE',
      [userId, upperCurrency]
    );
    const spendableWallet = walletRows[0];

    if (!spendableWallet || parseFloat(spendableWallet.balance) < numericAmount) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient spendable balance for this gift card amount' });
    }

    // Deduct from spendable balance
    await connection.execute(
      'UPDATE wallets SET balance = balance - ? WHERE id = ?',
      [numericAmount, spendableWallet.id]
    );

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
      `INSERT INTO gift_cards (code, created_by, amount, currency, status, message)
       VALUES (?, ?, ?, ?, 'active', ?)`,
      [code, userId, numericAmount, upperCurrency, message || null]
    );

    await connection.execute(
      `INSERT INTO wallet_transactions (from_wallet_id, transaction_type, amount, currency, description, status, processed_at)
       VALUES (?, 'gift_card_issue', ?, ?, ?, 'completed', NOW())`,
      [spendableWallet.id, numericAmount, upperCurrency, `Gift card ${code} created from spendable balance`]
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
    res.status(500).json({ success: false, message: 'Failed to create gift card', error: error.message });
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
      await connection.execute('UPDATE gift_cards SET status = "expired" WHERE id = ?', [card.id]);
      await connection.commit();
      return res.status(400).json({ success: false, message: 'This gift card has expired' });
    }

    // Get or create the redeemer's spendable wallet in the card's currency
    const [walletRows] = await connection.execute(
      'SELECT * FROM wallets WHERE user_id = ? AND wallet_type = "spendable" AND currency = ? AND status = "active" FOR UPDATE',
      [userId, card.currency]
    );
    let spendableWallet = walletRows[0];
    if (!spendableWallet) {
      const [created] = await connection.execute(
        'INSERT INTO wallets (user_id, wallet_type, currency, balance, status) VALUES (?, "spendable", ?, 0.00, "active")',
        [userId, card.currency]
      );
      spendableWallet = { id: created.insertId, balance: 0 };
    }

    // Credit the wallet
    await connection.execute(
      'UPDATE wallets SET balance = balance + ? WHERE id = ?',
      [card.amount, spendableWallet.id]
    );

    // Mark the card redeemed — this, combined with the row lock above, is
    // what guarantees a card can never be redeemed twice
    await connection.execute(
      'UPDATE gift_cards SET status = "redeemed", redeemed_by = ?, redeemed_at = NOW() WHERE id = ?',
      [userId, card.id]
    );

    await connection.execute(
      `INSERT INTO wallet_transactions (to_wallet_id, transaction_type, amount, currency, description, status, processed_at)
       VALUES (?, 'gift_card_redeem', ?, ?, ?, 'completed', NOW())`,
      [spendableWallet.id, card.amount, card.currency, `Gift card ${card.code} redeemed`]
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
    res.status(500).json({ success: false, message: 'Failed to redeem gift card', error: error.message });
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
    res.status(500).json({ success: false, message: 'Failed to fetch gift cards', error: error.message });
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
    res.status(500).json({ success: false, message: 'Failed to fetch transactions', error: error.message });
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
    res.status(500).json({ success: false, message: 'Debug failed', error: error.message });
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
      'SELECT * FROM wallets WHERE user_id = ? AND wallet_type = "withdrawable" AND currency = ? AND status = "active" FOR UPDATE',
      [userId, String(currency).toUpperCase()]
    );
    const withdrawableWallet = walletRows[0];

    if (!withdrawableWallet || parseFloat(withdrawableWallet.balance) < amount) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Insufficient withdrawable balance' });
    }

    // Get or create spendable wallet
    const [spendableRows] = await connection.execute(
      'SELECT * FROM wallets WHERE user_id = ? AND wallet_type = "spendable" AND currency = ? AND status = "active" FOR UPDATE',
      [userId, String(currency).toUpperCase()]
    );
    let spendableWallet = spendableRows[0];
    if (!spendableWallet) {
      const [created] = await connection.execute(
        'INSERT INTO wallets (user_id, wallet_type, currency, balance, status) VALUES (?, "spendable", ?, 0.00, "active")',
        [userId, String(currency).toUpperCase()]
      );
      spendableWallet = { id: created.insertId, balance: 0 };
    }

    // Transfer from withdrawable to spendable
    await connection.execute(
      'UPDATE wallets SET balance = balance - ? WHERE id = ?',
      [amount, withdrawableWallet.id]
    );

    await connection.execute(
      'UPDATE wallets SET balance = balance + ? WHERE id = ?',
      [amount, spendableWallet.id]
    );

    // Record transfer transaction
    await connection.execute(
      `INSERT INTO wallet_transactions (
        from_wallet_id, to_wallet_id, transaction_type, amount, currency,
        description, status, processed_at
      ) VALUES (?, ?, 'internal_transfer', ?, ?, ?, 'completed', NOW())`,
      [
        withdrawableWallet.id, spendableWallet.id, amount, currency,
        `Transfer from withdrawable to spendable wallet`
      ]
    );

    await connection.commit();

    res.json({
      success: true,
      message: 'Transfer successful',
      transferredAmount: amount
    });
  } catch (error) {
    await connection.rollback();
    console.error('Transfer to spendable failed:', error);
    res.status(500).json({ success: false, message: 'Transfer failed', error: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
