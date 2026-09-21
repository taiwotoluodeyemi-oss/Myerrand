import React, { useState, useEffect } from 'react'
import axios from 'axios'
import './PayNow.css'

function PayNow({ user, setUser }) {
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('paystack')
  const [isProcessing, setIsProcessing] = useState(false)
  const [message, setMessage] = useState('')
  const [operationType, setOperationType] = useState(user.userType === 'client' ? 'deposit' : 'withdraw')
  const [selectedAccount, setSelectedAccount] = useState('spendable')
  const [wallets, setWallets] = useState([])
  const [withdrawalMethods, setWithdrawalMethods] = useState([])
  const [selectedWithdrawalMethod, setSelectedWithdrawalMethod] = useState('')
  const [cardDetails, setCardDetails] = useState({
    cardNumber: '',
    expiryDate: '',
    cvv: '',
    cardHolder: ''
  })

  // New state for transfer button processing
  const [isTransferProcessing, setIsTransferProcessing] = useState(false)
  
  // Fetch wallet data on component mount
  useEffect(() => {
    fetchWallets()
    fetchWithdrawalMethods()
    // Check for Paystack callback
    const urlParams = new URLSearchParams(window.location.search)
    const reference = urlParams.get('reference') || urlParams.get('trxref')
    if (reference) {
      verifyPaystackPayment(reference)
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  const fetchWallets = async () => {
    try {
      const response = await axios.get('/api/wallet/wallets')
      if (response.data.success) {
        setWallets(response.data.wallets)
      }
    } catch (error) {
      console.error('Error fetching wallets:', error)
    }
  }

  const fetchWithdrawalMethods = async () => {
    try {
      const response = await axios.get('/api/wallet/withdrawal-methods')
      if (response.data.success) {
        setWithdrawalMethods(response.data.methods)
        if (response.data.methods.length > 0) {
          setSelectedWithdrawalMethod(response.data.methods[0].id)
        }
      }
    } catch (error) {
      console.error('Error fetching withdrawal methods:', error)
    }
  }

  // Handler for transferring full withdrawable balance to spendable balance
  const handleTransferWithdrawableToSpendable = async () => {
    const withdrawableBalance = getWalletBalance('withdrawable')
    if (withdrawableBalance <= 0) {
      setMessage('No withdrawable balance to transfer.')
      return
    }
    setIsTransferProcessing(true)
    setMessage('')
    try {
      const response = await axios.post('/api/wallet/transfer', {
        amount: withdrawableBalance,
        fromCurrency: 'USD',
        toCurrency: 'USD',
        direction: 'withdrawable_to_spendable'
      })
      if (response.data.success) {
        setMessage('Transfer successful!')
        fetchWallets()
      } else {
        setMessage(response.data.message || 'Transfer failed')
      }
    } catch (error) {
      setMessage('Transfer failed: ' + (error.response?.data?.message || error.message))
      console.error('Transfer error:', error)
    } finally {
      setIsTransferProcessing(false)
    }
  }

  const verifyPaystackPayment = async (reference) => {
    try {
      const response = await axios.post('/api/wallet/paystack/verify', { reference })
      if (response.data.success) {
        setMessage('Payment verified and deposit successful!')
        fetchWallets() // Refresh wallet balances
      } else {
        setMessage('Payment verification failed')
      }
    } catch (error) {
      setMessage('Payment verification error: ' + (error.response?.data?.message || error.message))
    }
  }

  const getWalletBalance = (walletType) => {
    const wallet = wallets.find(w => w.wallet_type === walletType && w.currency === 'USD')
    return wallet ? parseFloat(wallet.balance) || 0 : 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsProcessing(true)
    setMessage('')
    
    const numAmount = parseFloat(amount)
    
    // Additional validation
    if (numAmount <= 0) {
      setMessage('Please enter a valid amount greater than $0.')
      setIsProcessing(false)
      return
    }
    
    try {
      if (operationType === 'deposit') {
        if (paymentMethod === 'paystack') {
          // Initialize Paystack transaction
          const response = await axios.post('/api/wallet/deposit/create-intent', {
            amount: numAmount,
            currency: 'NGN', // Paystack works with NGN
            paymentMethod: 'paystack',
            email: user.email
          })
          
          if (response.data.success) {
            if (response.data.devMode) {
              // Dev-mode deposit already completed synchronously server-side —
              // no redirect (which would drop the auth token on the next call
              // anyway), just reflect the new balance.
              setMessage(response.data.message || 'Dev mode deposit successful!')
              fetchWallets()
              setAmount('')
            } else {
              // Redirect to Paystack payment page
              window.location.href = response.data.authorization_url
            }
          } else {
            setMessage('Failed to initialize payment')
          }
        }
      } else if (operationType === 'withdraw') {
        if (!selectedWithdrawalMethod) {
          setMessage('Please select a withdrawal method')
          setIsProcessing(false)
          return
        }
        
        const response = await axios.post('/api/wallet/withdraw', {
          amount: numAmount,
          currency: 'USD',
          withdrawalMethodId: selectedWithdrawalMethod
        })
        
        if (response.data.success) {
          setMessage(`Withdrawal successful! Net amount: $${response.data.netAmount}`)
          fetchWallets()
          setAmount('')
        } else {
          setMessage(response.data.message || 'Withdrawal failed')
        }
      } else if (operationType === 'transfer') {
        // This tab is labeled "Transfer to Spendable" in the UI — same
        // direction as handleTransferWithdrawableToSpendable above, just for
        // a user-chosen amount instead of the full withdrawable balance.
        const response = await axios.post('/api/wallet/transfer', {
          amount: numAmount,
          fromCurrency: 'USD',
          toCurrency: 'USD',
          direction: 'withdrawable_to_spendable'
        })
        
        if (response.data.success) {
          setMessage('Transfer successful!')
          fetchWallets()
          setAmount('')
        } else {
          setMessage(response.data.message || 'Transfer failed')
        }
      }
      
    } catch (error) {
      setMessage('Transaction failed: ' + (error.response?.data?.message || error.message))
      console.error('Payment error:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCardInputChange = (e) => {
    setCardDetails({
      ...cardDetails,
      [e.target.name]: e.target.value
    })
  }

  return (
    <div className="payment-page">
      <div className="balance-display">
        <h3>Wallet Balances</h3>
        <div className="balance-section">
          <div className="balance-item">
            <span className="balance-label">💰 Spendable Balance:</span>
            <span className="balance-amount">${getWalletBalance('spendable').toFixed(2)}</span>
          </div>
          <div className="balance-item">
            <span className="balance-label">💳 Withdrawable Balance:</span>
            <span className="balance-amount">${getWalletBalance('withdrawable').toFixed(2)}</span>
          </div>
          <div className="balance-item">
            <span className="balance-label">🔒 Escrow Balance:</span>
            <span className="balance-amount">${getWalletBalance('escrow').toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="payment-tabs">
        <button 
          className={operationType === 'withdraw' ? 'tab active' : 'tab'}
            onClick={() => {
              setOperationType('withdraw')
              setSelectedAccount(user.userType === 'client' ? 'normal' : 'withdrawable')
            }}
        >
          💸 Withdraw Funds
        </button>
        <button 
          className={operationType === 'deposit' ? 'tab active' : 'tab'}
          onClick={() => {
            setOperationType('deposit')
            setSelectedAccount('normal')
          }}
        >
          💰 Add Funds
        </button>
        <button 
          className={operationType === 'transfer' ? 'tab active' : 'tab'}
          onClick={() => {
            setOperationType('transfer')
            setSelectedAccount('withdrawable')
          }}
        >
          🔄 Transfer to Spendable
        </button>
      </div>
      
      {message && (
        <div className={`message ${message.includes('Success') ? 'success' : 'error'}`}>
          {message}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="payment-form">
        <div className="form-group">
          <label htmlFor="account-selector">Select Wallet</label>
          <select 
            id="account-selector"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
          >
            {operationType === 'withdraw' ? (
              <>
                <option value="withdrawable">💳 Withdrawable Wallet (${getWalletBalance('withdrawable').toFixed(2)})</option>
                <option value="spendable">💰 Spendable Wallet (${getWalletBalance('spendable').toFixed(2)})</option>
              </>
            ) : (
              <>
                <option value="spendable">💰 Spendable Wallet (${getWalletBalance('spendable').toFixed(2)})</option>
                <option value="withdrawable">💳 Withdrawable Wallet (${getWalletBalance('withdrawable').toFixed(2)})</option>
              </>
            )}
          </select>
        </div>

        {operationType === 'withdraw' && withdrawalMethods.length > 0 && (
          <div className="form-group">
            <label htmlFor="withdrawal-method">Withdrawal Method</label>
            <select 
              id="withdrawal-method"
              value={selectedWithdrawalMethod}
              onChange={(e) => setSelectedWithdrawalMethod(e.target.value)}
            >
              {withdrawalMethods.map(method => (
                <option key={method.id} value={method.id}>
                  {method.method_name} ({method.method_type})
                </option>
              ))}
            </select>
          </div>
        )}
        
        <div className="form-group">
          <label htmlFor="amount">
            {operationType === 'withdraw' ? 'Withdrawal' : 'Deposit'} Amount ($)
          </label>
          <input 
            type="number" 
            id="amount"
            min="1"
            max={operationType === 'withdraw' ? getWalletBalance(selectedAccount) : '10000'}
            step="0.01"
            value={amount} 
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
          {operationType === 'withdraw' && (
            <small>Maximum: ${getWalletBalance(selectedAccount).toFixed(2)}</small>
          )}
        </div>
        
        <div className="form-group">
          <label htmlFor="payment-method">Payment Method</label>
          <select 
            id="payment-method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            <option value="paystack">Paystack (Recommended)</option>
            <option value="credit">Credit Card</option>
            <option value="debit">Debit Card</option>
            <option value="paypal">PayPal</option>
            <option value="bank">Bank Transfer</option>
          </select>
        </div>

        {(paymentMethod === 'credit' || paymentMethod === 'debit') && (
          <div className="card-details">
            <h4>Card Information</h4>
            
            <div className="form-group">
              <label htmlFor="cardHolder">Card Holder Name</label>
              <input
                type="text"
                id="cardHolder"
                name="cardHolder"
                value={cardDetails.cardHolder}
                onChange={handleCardInputChange}
                placeholder="John Doe"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="cardNumber">Card Number</label>
              <input
                type="text"
                id="cardNumber"
                name="cardNumber"
                value={cardDetails.cardNumber}
                onChange={handleCardInputChange}
                placeholder="1234 5678 9012 3456"
                maxLength="19"
                required
              />
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="expiryDate">Expiry Date</label>
                <input
                  type="text"
                  id="expiryDate"
                  name="expiryDate"
                  value={cardDetails.expiryDate}
                  onChange={handleCardInputChange}
                  placeholder="MM/YY"
                  maxLength="5"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="cvv">CVV</label>
                <input
                  type="text"
                  id="cvv"
                  name="cvv"
                  value={cardDetails.cvv}
                  onChange={handleCardInputChange}
                  placeholder="123"
                  maxLength="4"
                  required
                />
              </div>
            </div>
          </div>
        )}
        
        <button 
          type="submit" 
          className="button payment-button primary"
          disabled={isProcessing || !amount || parseFloat(amount) <= 0}
        >
          {isProcessing ? (
            <span>
              <span className="spinner">⏳</span>
              Processing...
            </span>
          ) : (
            operationType === 'withdraw' ? 
              `Withdraw $${amount || '0.00'}` : 
              `Add $${amount || '0.00'}`
          )}
        </button>
      </form>

      <div className="payment-info">
        <h4>💡 Payment Information</h4>
        <ul>
          <li>Withdrawals are processed within 1-3 business days</li>
          <li>Minimum withdrawal amount is $1.00</li>
          <li>Added funds are available immediately</li>
          <li>All transactions are secure and encrypted</li>
        </ul>
      </div>

      {/* New button to transfer withdrawable balance to spendable */}
      <div className="transfer-button-container" style={{ marginTop: '1rem' }}>
        <button
          className="button secondary"
          onClick={handleTransferWithdrawableToSpendable}
          disabled={isTransferProcessing || getWalletBalance('withdrawable') <= 0}
        >
          {isTransferProcessing ? 'Transferring...' : 'Transfer Withdrawable to Spendable'}
        </button>
      </div>
    </div>
  )
}

export default PayNow
