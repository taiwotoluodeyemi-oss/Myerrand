import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const WalletManager = () => {
  const [wallets, setWallets] = useState([]);
  const [totalBalance, setTotalBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawalMethods, setWithdrawalMethods] = useState([]);
  const [selectedWithdrawalMethod, setSelectedWithdrawalMethod] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('paystack'); // Default to Paystack
  const [userEmail, setUserEmail] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Auth header helper
  const authHeaders = () => ({ headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' } });

  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [availableCurrencies, setAvailableCurrencies] = useState([]);

  // Gift card reward system state
  const [giftCardAmount, setGiftCardAmount] = useState('');
  const [giftCardMessage, setGiftCardMessage] = useState('');
  const [giftCardLoading, setGiftCardLoading] = useState(false);
  const [lastCreatedGiftCard, setLastCreatedGiftCard] = useState(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [myGiftCards, setMyGiftCards] = useState({ created: [], redeemed: [] });

  // Withdrawal method setup (was previously unreachable from the UI)
  const [showAddMethod, setShowAddMethod] = useState(false);
  const [newMethodType, setNewMethodType] = useState('bank_transfer');
  const [newMethodName, setNewMethodName] = useState('');
  const [newMethodDetails, setNewMethodDetails] = useState({ email: '', account_name: '', account_number: '', bank_code: '' });
  const [addMethodLoading, setAddMethodLoading] = useState(false);

  // Fetch wallet data with total balance calculation
  // BUGFIX: this used to always fetch the raw, currency-unfiltered total, so
  // switching the currency dropdown never actually changed the balance
  // shown. It now fetches wallets scoped to the currently selected currency.
  const fetchWallets = useCallback(async (currency = selectedCurrency) => {
    try {
      const response = await axios.get(`/api/wallet/wallets?currency=${currency}`, authHeaders());
      if (response.data.success) {
        setWallets(response.data.wallets);
        setTotalBalance(response.data.totalBalance || 0);
      }
    } catch (error) {
      console.error('Error fetching wallets:', error);
    }
  }, [selectedCurrency]);
  
  // Force refresh all wallet data
  const refreshWalletData = useCallback(async () => {
    await Promise.all([
      fetchWallets(selectedCurrency),
      fetchTransactions(),
      fetchWithdrawalMethods(),
      fetchCurrencies(),
      fetchBalanceSummary(selectedCurrency)
    ]);
    setRefreshTrigger(prev => prev + 1);
  }, [fetchWallets, selectedCurrency]);

  // Fetch transaction history
  const fetchTransactions = async () => {
    try {
      const response = await axios.get('/api/wallet/transactions?limit=10', authHeaders());
      if (response.data.success) {
        setTransactions(response.data.transactions);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  // Fetch withdrawal methods
  const fetchWithdrawalMethods = async () => {
    try {
      const response = await axios.get('/api/wallet/withdrawal-methods', authHeaders());
      if (response.data.success) {
        setWithdrawalMethods(response.data.methods);
      }
    } catch (error) {
      console.error('Error fetching withdrawal methods:', error);
    }
  };

  const fetchCurrencies = async () => {
    try {
      const response = await axios.get('/api/wallet/currencies', authHeaders());
      if (response.data.success) setAvailableCurrencies(response.data.currencies);
    } catch (e) { console.error('Error fetching currencies', e); }
  };

  const fetchBalanceSummary = async (currency) => {
    try {
      const response = await axios.get(`/api/wallet/balance-summary?currency=${currency}`, authHeaders());
      // Optionally use response.data.symbol
    } catch (e) { console.error('Error fetching balance summary', e); }
  };

  // Fetch the user's created + redeemed gift cards
  const fetchMyGiftCards = async () => {
    try {
      const response = await axios.get('/api/wallet/giftcards/mine', authHeaders());
      if (response.data.success) {
        setMyGiftCards({ created: response.data.created, redeemed: response.data.redeemed });
      }
    } catch (error) {
      console.error('Error fetching gift cards:', error);
    }
  };

  useEffect(() => {
    fetchWallets();
    fetchTransactions();
    fetchWithdrawalMethods();
    fetchCurrencies();
    fetchBalanceSummary(selectedCurrency);
    fetchMyGiftCards();
  }, []);

  // Create a gift card funded from the current spendable balance
  const handleCreateGiftCard = async () => {
    if (!giftCardAmount || parseFloat(giftCardAmount) <= 0) return;

    setGiftCardLoading(true);
    setLastCreatedGiftCard(null);
    try {
      const response = await axios.post('/api/wallet/giftcards/create', {
        amount: parseFloat(giftCardAmount),
        currency: selectedCurrency,
        message: giftCardMessage || undefined
      }, authHeaders());

      if (response.data.success) {
        setLastCreatedGiftCard(response.data.giftCard);
        setGiftCardAmount('');
        setGiftCardMessage('');
        await Promise.all([refreshWalletData(), fetchMyGiftCards()]);
      }
    } catch (error) {
      alert('Could not create gift card: ' + (error.response?.data?.message || error.message));
    } finally {
      setGiftCardLoading(false);
    }
  };

  // Redeem a gift card code into the spendable balance
  const handleRedeemGiftCard = async () => {
    if (!redeemCode.trim()) return;

    setRedeemLoading(true);
    try {
      const response = await axios.post('/api/wallet/giftcards/redeem', { code: redeemCode.trim() }, authHeaders());
      if (response.data.success) {
        alert(`Redeemed ${response.data.currency} ${response.data.amount.toFixed(2)} into your spendable balance!`);
        setRedeemCode('');
        await Promise.all([refreshWalletData(), fetchMyGiftCards()]);
      }
    } catch (error) {
      alert('Could not redeem gift card: ' + (error.response?.data?.message || error.message));
    } finally {
      setRedeemLoading(false);
    }
  };

  // Save a withdrawal method (bank account or PayPal payout email).
  // This is what "sets up" a payout method — the backend only activates
  // real transfers once matching provider credentials are configured.
  const handleAddWithdrawalMethod = async () => {
    if (!newMethodName.trim()) return;
    if (newMethodType === 'paypal' && !newMethodDetails.email) return;
    if (newMethodType === 'bank_transfer' && (!newMethodDetails.account_number || !newMethodDetails.bank_code)) return;

    setAddMethodLoading(true);
    try {
      const accountDetails = newMethodType === 'paypal'
        ? { email: newMethodDetails.email }
        : { account_name: newMethodDetails.account_name, account_number: newMethodDetails.account_number, bank_code: newMethodDetails.bank_code };

      const response = await axios.post('/api/wallet/withdrawal-methods', {
        methodType: newMethodType,
        methodName: newMethodName,
        accountDetails
      }, authHeaders());

      if (response.data.success) {
        setNewMethodName('');
        setNewMethodDetails({ email: '', account_name: '', account_number: '', bank_code: '' });
        setShowAddMethod(false);
        await fetchWithdrawalMethods();
      }
    } catch (error) {
      alert('Could not save withdrawal method: ' + (error.response?.data?.message || error.message));
    } finally {
      setAddMethodLoading(false);
    }
  };

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;

    setLoading(true);
    try {
      if (paymentMethod === 'paystack') {
        // Step 1: Initialize Paystack transaction
        const intentResponse = await axios.post('/api/wallet/deposit/create-intent', {
          amount: parseFloat(depositAmount),
          currency: selectedCurrency,
          paymentMethod: 'paystack',
          email: userEmail || 'user@example.com' // In production, get from user profile
        }, authHeaders());

        if (intentResponse.data.success) {
          if (intentResponse.data.devMode) {
            // Dev-mode deposit already completed synchronously server-side —
            // no redirect, just reflect the new balance.
            alert(intentResponse.data.message || 'Dev mode deposit successful!');
            setDepositAmount('');
            await refreshWalletData();
          } else {
            // Redirect to Paystack payment page
            window.location.href = intentResponse.data.authorization_url;
          }
        }
      }
    } catch (error) {
      alert('Deposit failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  // Handle Paystack callback verification
  const verifyPaystackPayment = async (reference) => {
    try {
      const response = await axios.post('/api/wallet/paystack/verify', {
        reference
      }, authHeaders());

      if (response.data.success) {
        alert('Payment verified and deposit successful!');
        await refreshWalletData();
      } else {
        alert('Payment verification failed');
      }
    } catch (error) {
      alert('Payment verification error: ' + (error.response?.data?.message || error.message));
    }
  };

  // Check for Paystack callback on component mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const reference = urlParams.get('reference');
    const trxref = urlParams.get('trxref');
    
    if (reference || trxref) {
      verifyPaystackPayment(reference || trxref);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleTransfer = async () => {
    if (!transferAmount || parseFloat(transferAmount) <= 0) return;

    setLoading(true);
    try {
      const response = await axios.post('/api/wallet/transfer', {
        amount: parseFloat(transferAmount),
        fromCurrency: selectedCurrency,
        toCurrency: selectedCurrency,
        direction: 'spendable_to_withdrawable' // matches the "Transfer to Withdrawable" label below
      }, authHeaders());

      if (response.data.success) {
        alert('Transfer successful!');
        setTransferAmount('');
        await refreshWalletData();
      }
    } catch (error) {
      alert('Transfer failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0 || !selectedWithdrawalMethod) return;

    setLoading(true);
    try {
      const response = await axios.post('/api/wallet/withdraw', {
        amount: parseFloat(withdrawAmount),
        currency: selectedCurrency,
        withdrawalMethodId: selectedWithdrawalMethod
      }, authHeaders());

      if (response.data.success) {
        alert(`Withdrawal successful! Net amount: $${response.data.netAmount}`);
        setWithdrawAmount('');
        await refreshWalletData();
      }
    } catch (error) {
      alert('Withdrawal failed: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const getWalletBalance = (walletType) => {
    // BUGFIX: this was hardcoded to 'USD', so switching the currency
    // dropdown never changed what these cards showed — and if the user's
    // USD wallet happened to be empty, it would show $0.00 forever even
    // with real funds sitting in another currency's wallet.
    const wallet = wallets.find(w => w.wallet_type === walletType && w.currency === selectedCurrency);
    return wallet ? parseFloat(wallet.balance) : 0;
  };

  return (
    <div className="wallet-manager p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Wallet Management</h1>
      
      {/* Total Balance */}
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 p-6 rounded-lg border border-purple-200 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold mb-2 text-purple-800">Total Account Balance</h2>
          <div>
            <select value={selectedCurrency} onChange={async (e) => { const newCurrency = e.target.value; setSelectedCurrency(newCurrency); await Promise.all([fetchWallets(newCurrency), fetchBalanceSummary(newCurrency)]); }} className="p-2 border rounded">
              {availableCurrencies.map(c => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-4xl font-bold text-purple-600">
          ${totalBalance.toFixed(2)} {selectedCurrency}
        </p>
        <p className="text-sm text-purple-700 mt-2">
          Combined balance across all wallet types
        </p>
      </div>

      {/* Wallet Balances */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-blue-50 p-6 rounded-lg border">
          <h2 className="text-xl font-semibold mb-2">Spendable Balance</h2>
          <p className="text-3xl font-bold text-blue-600">
            ${getWalletBalance('spendable').toFixed(2)} {selectedCurrency}
          </p>
          <p className="text-sm text-gray-600 mt-2">
            Use this balance to pay for errands
          </p>
        </div>
        
        <div className="bg-green-50 p-6 rounded-lg border">
          <h2 className="text-xl font-semibold mb-2">Withdrawable Balance</h2>
          <p className="text-3xl font-bold text-green-600">
            ${getWalletBalance('withdrawable').toFixed(2)} {selectedCurrency}
          </p>
          <p className="text-sm text-gray-600 mt-2">
            Transfer to bank account or withdraw as cash
          </p>
        </div>
      </div>

      {/* Gift Card Rewards */}
      <div className="bg-white p-6 rounded-lg border mb-8">
        <h2 className="text-xl font-semibold mb-1">🎁 Gift Card Rewards</h2>
        <p className="text-sm text-gray-600 mb-4">
          Turn part of your spendable balance into a gift card, or redeem a code someone sent you.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Create a gift card */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Create a Gift Card</h3>
            <input
              type="number"
              placeholder={`Amount (${selectedCurrency})`}
              value={giftCardAmount}
              onChange={(e) => setGiftCardAmount(e.target.value)}
              className="w-full p-2 border rounded mb-2"
            />
            <input
              type="text"
              placeholder="Optional message (e.g. Happy birthday!)"
              value={giftCardMessage}
              onChange={(e) => setGiftCardMessage(e.target.value)}
              className="w-full p-2 border rounded mb-2"
            />
            <button
              onClick={handleCreateGiftCard}
              disabled={giftCardLoading}
              className="w-full bg-pink-500 text-white p-2 rounded hover:bg-pink-600 disabled:opacity-50"
            >
              {giftCardLoading ? 'Creating...' : 'Create Gift Card'}
            </button>
            <p className="text-xs text-gray-500 mt-2">
              Deducted from your spendable balance ({selectedCurrency})
            </p>

            {lastCreatedGiftCard && (
              <div className="mt-4 p-3 bg-pink-50 border border-pink-200 rounded">
                <p className="text-sm text-pink-800">Share this code:</p>
                <p className="text-xl font-mono font-bold text-pink-700">{lastCreatedGiftCard.code}</p>
                <p className="text-sm text-pink-700">
                  Worth {lastCreatedGiftCard.currency} {lastCreatedGiftCard.amount.toFixed(2)}
                </p>
              </div>
            )}
          </div>

          {/* Redeem a gift card */}
          <div>
            <h3 className="text-lg font-semibold mb-2">Redeem a Gift Card</h3>
            <input
              type="text"
              placeholder="e.g. GIFT-AB12-CD34-EF56"
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
              className="w-full p-2 border rounded mb-2 font-mono"
            />
            <button
              onClick={handleRedeemGiftCard}
              disabled={redeemLoading}
              className="w-full bg-purple-500 text-white p-2 rounded hover:bg-purple-600 disabled:opacity-50"
            >
              {redeemLoading ? 'Redeeming...' : 'Redeem Code'}
            </button>
            <p className="text-xs text-gray-500 mt-2">
              Credits your spendable balance instantly
            </p>
          </div>
        </div>

        {/* Gift card history */}
        {(myGiftCards.created.length > 0 || myGiftCards.redeemed.length > 0) && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold mb-2">Your Gift Card History</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Code</th>
                    <th className="text-left p-2">Amount</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {myGiftCards.created.map(card => (
                    <tr key={`created-${card.id}`} className="border-b">
                      <td className="p-2 font-mono">{card.code}</td>
                      <td className="p-2">{card.currency} {parseFloat(card.amount).toFixed(2)}</td>
                      <td className="p-2">Created</td>
                      <td className="p-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          card.status === 'active' ? 'bg-yellow-100 text-yellow-800' :
                          card.status === 'redeemed' ? 'bg-green-100 text-green-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {card.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {myGiftCards.redeemed.map(card => (
                    <tr key={`redeemed-${card.id}`} className="border-b">
                      <td className="p-2 font-mono">{card.code}</td>
                      <td className="p-2">{card.currency} {parseFloat(card.amount).toFixed(2)}</td>
                      <td className="p-2">Redeemed</td>
                      <td className="p-2">
                        <span className="px-2 py-1 rounded text-xs bg-green-100 text-green-800">received</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      {/* Deposit */}
        <div className="bg-white p-6 rounded-lg border">
          <h3 className="text-lg font-semibold mb-4">Deposit Funds</h3>
          <input
            type="number"
            placeholder={`Amount (${selectedCurrency})`}
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className="w-full p-2 border rounded mb-2"
          />
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="w-full p-2 border rounded mb-4">
            <option value="paystack">Paystack</option>
          </select>
          <button
            onClick={handleDeposit}
            disabled={loading}
            className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Deposit'}
          </button>
          <p className="text-xs text-gray-500 mt-2">
            Funds go to spendable balance
          </p>
        </div>

      {/* Transfer */}
        <div className="bg-white p-6 rounded-lg border">
          <h3 className="text-lg font-semibold mb-4">Transfer to Withdrawable</h3>
          <input
            type="number"
            placeholder={`Amount (${selectedCurrency})`}
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            className="w-full p-2 border rounded mb-4"
          />
          <button
            onClick={handleTransfer}
            disabled={loading}
            className="w-full bg-orange-500 text-white p-2 rounded hover:bg-orange-600 disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Transfer'}
          </button>
          <p className="text-xs text-gray-500 mt-2">
            Move from spendable to withdrawable
          </p>
        </div>

      {/* Withdraw */}
        <div className="bg-white p-6 rounded-lg border">
          <h3 className="text-lg font-semibold mb-4">Withdraw Funds</h3>
          <input
            type="number"
            placeholder={`Amount (${selectedCurrency})`}
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            className="w-full p-2 border rounded mb-2"
          />
          <select
            value={selectedWithdrawalMethod}
            onChange={(e) => setSelectedWithdrawalMethod(e.target.value)}
            className="w-full p-2 border rounded mb-4"
          >
            <option value="">Select withdrawal method</option>
            {withdrawalMethods.map(method => (
              <option key={method.id} value={method.id}>
                {method.method_name} ({method.method_type})
              </option>
            ))}
          </select>
          <button
            onClick={handleWithdraw}
            disabled={loading}
            className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600 disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Withdraw'}
          </button>
          <p className="text-xs text-gray-500 mt-2">
            2% withdrawal fee applies
          </p>

          <button
            onClick={() => setShowAddMethod(!showAddMethod)}
            className="w-full text-sm text-blue-600 underline mt-3"
          >
            {showAddMethod ? 'Cancel' : '+ Add a payout method'}
          </button>

          {showAddMethod && (
            <div className="mt-3 p-3 border rounded bg-gray-50">
              <select
                value={newMethodType}
                onChange={(e) => setNewMethodType(e.target.value)}
                className="w-full p-2 border rounded mb-2"
              >
                <option value="bank_transfer">Bank account</option>
                <option value="paypal">PayPal</option>
              </select>
              <input
                type="text"
                placeholder="Label (e.g. My GTBank account)"
                value={newMethodName}
                onChange={(e) => setNewMethodName(e.target.value)}
                className="w-full p-2 border rounded mb-2"
              />
              {newMethodType === 'paypal' ? (
                <input
                  type="email"
                  placeholder="PayPal email"
                  value={newMethodDetails.email}
                  onChange={(e) => setNewMethodDetails({ ...newMethodDetails, email: e.target.value })}
                  className="w-full p-2 border rounded mb-2"
                />
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Account holder name"
                    value={newMethodDetails.account_name}
                    onChange={(e) => setNewMethodDetails({ ...newMethodDetails, account_name: e.target.value })}
                    className="w-full p-2 border rounded mb-2"
                  />
                  <input
                    type="text"
                    placeholder="Account number"
                    value={newMethodDetails.account_number}
                    onChange={(e) => setNewMethodDetails({ ...newMethodDetails, account_number: e.target.value })}
                    className="w-full p-2 border rounded mb-2"
                  />
                  <input
                    type="text"
                    placeholder="Bank code (Paystack bank code)"
                    value={newMethodDetails.bank_code}
                    onChange={(e) => setNewMethodDetails({ ...newMethodDetails, bank_code: e.target.value })}
                    className="w-full p-2 border rounded mb-2"
                  />
                </>
              )}
              <button
                onClick={handleAddWithdrawalMethod}
                disabled={addMethodLoading}
                className="w-full bg-gray-700 text-white p-2 rounded hover:bg-gray-800 disabled:opacity-50"
              >
                {addMethodLoading ? 'Saving...' : 'Save Method'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Transaction History */}
      <div className="bg-white p-6 rounded-lg border">
        <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Amount</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(tx => (
                <tr key={tx.id} className="border-b">
                  <td className="p-2">
                    {new Date(tx.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-2 capitalize">{tx.transaction_type}</td>
                  <td className="p-2">
                    <span className={tx.transaction_type === 'deposit' || tx.transaction_type === 'earning' ? 'text-green-600' : 'text-red-600'}>
                      {tx.transaction_type === 'deposit' || tx.transaction_type === 'earning' ? '+' : '-'}
                      ${tx.amount} {tx.currency}
                    </span>
                  </td>
                  <td className="p-2">
                    <span className={`px-2 py-1 rounded text-xs ${
                      tx.status === 'completed' ? 'bg-green-100 text-green-800' :
                      tx.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {tx.status}
                    </span>
                  </td>
                  <td className="p-2">{tx.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default WalletManager;
