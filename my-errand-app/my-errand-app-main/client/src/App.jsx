import React, { useState, useEffect, Suspense } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import axios from 'axios'
import ProtectedRoute from './components/ProtectedRoute'
import LanguageSwitcher from './components/LanguageSwitcher'
import CurrencySwitcher from './components/CurrencySwitcher'
import NotificationBell from './components/NotificationBell'
import { TranslationProvider } from './contexts/TranslationContext'
import { emitPageLifecycle, registerBackLifecycle } from './cordova'
import { API_BASE } from './api'
import { detectCurrency, detectLanguage } from './utils/localeCurrency'
import './App.css'

// Lazy load components
const Home = React.lazy(() => import('./pages/Home'))
const PayNow = React.lazy(() => import('./pages/PayNow'))
const ErrandList = React.lazy(() => import('./pages/ErrandList'))
const Profile = React.lazy(() => import('./pages/Profile'))
const Login = React.lazy(() => import('./pages/Login'))
const Register = React.lazy(() => import('./pages/Register'))
const RegisterClient = React.lazy(() => import('./pages/RegisterClient'))
const RegisterRunner = React.lazy(() => import('./pages/RegisterRunner'))
const UserTypeSelection = React.lazy(() => import('./pages/UserTypeSelection'))
const ClientDashboard = React.lazy(() => import('./pages/ClientDashboard'))
const RunnerDashboard = React.lazy(() => import('./pages/RunnerDashboard'))
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'))
const ForgotPassword = React.lazy(() => import('./pages/ForgotPassword'))

function App() {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [userBalances, setUserBalances] = useState({ spendable: 0, withdrawable: 0, escrow: 0, total: 0 })   ///find ou how to get the information from the backend instead.
  const [errands, setErrands] = useState([])
  const location = useLocation()
  const isAuthenticated = !!user

  // Automatic language + currency from browser (user can override in header)
  useEffect(() => {
    try {
      const lang = detectLanguage()
      const cur = detectCurrency()
      if (!localStorage.getItem('preferredCurrency')) {
        localStorage.setItem('preferredCurrency', cur)
      }
      // i18n already detects; ensure currency event for wallet widgets
      window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: localStorage.getItem('preferredCurrency') || cur } }))
    } catch (_) {}
  }, [])


  useEffect(() => {
    const stopPageLifecycle = emitPageLifecycle(location.pathname)
    const stopBackLifecycle = registerBackLifecycle()

    return () => {
      stopPageLifecycle()
      stopBackLifecycle()
    }
  }, [location.pathname])

  // Fetch user balance
  const fetchUserBalance = async () => {
    if (!user) return
    try {
      const token = localStorage.getItem('token')
      const response = await axios.get('/api/wallet/balance-summary', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (response.data.success) {
        setUserBalances(response.data.balances)
      }
    } catch (error) {
      console.error('Error fetching user balance:', error)
    }
  }

  // Check for existing authentication on app load
  useEffect(() => {
    if (API_BASE) {
      axios.defaults.baseURL = API_BASE
    }

    const token = localStorage.getItem('token')
    const savedUser = localStorage.getItem('user')

    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    }

    if (token && savedUser) {
      try {
        const userData = JSON.parse(savedUser)
        setUser(userData)
      } catch (error) {
        console.error('Error parsing saved user data:', error)
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        delete axios.defaults.headers.common['Authorization']
      }
    }
    setIsLoading(false)
  }, [])


  // Load errands from API (no sample data)
  const fetchErrands = async () => {
    if (!user) { setErrands([]); return }
    try {
      const token = localStorage.getItem('token')
      const role = user.userType || user.user_type
      const path = role === 'runner' ? '/api/errands/runner' : role === 'admin' ? '/api/admin/errands' : '/api/errands/client'
      const response = await axios.get(path, { headers: { Authorization: `Bearer ${token}` } })
      const list = response.data?.data?.errands || response.data?.errands || response.data?.data || []
      setErrands(Array.isArray(list) ? list : [])
    } catch (e) {
      console.error('Error fetching errands', e)
      setErrands([])
    }
  }

  useEffect(() => {
    if (user) fetchErrands()
  }, [user])

  // Fetch balance when user is set
  useEffect(() => {
    if (user) {
      fetchUserBalance()
      // Set up periodic balance refresh
      const interval = setInterval(fetchUserBalance, 10000) // Refresh every 10 seconds
      return () => clearInterval(interval)
    }
  }, [user])

  const addErrand = (newErrand) => {
    const errand = {
      id: Date.now(),
      ...newErrand,
      status: 'pending'
    }
    setErrands(prev => [...prev, errand])
  }

  const updateErrandStatus = (id, status) => {
    setErrands(prev => prev.map(errand =>
      errand.id === id ? { ...errand, status } : errand
    ))
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    delete axios.defaults.headers.common['Authorization']
    setUser(null)
  }

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/': return 'Dashboard'
      case '/errands': return 'My Errands'
      case '/pay': return 'Payment'
      case '/profile': return 'Profile'
      case '/login': return 'Sign In'
      case '/register': return 'Sign Up'
      default: return 'My Errand'
    }
  }

  if (isLoading) {
    return (
      <div className="app loading">
        <div className="loading-container">
          <h2>🏃‍♂️ My Errand</h2>
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <TranslationProvider>
      <div className="app">
        {/* Only show header and footer for authenticated users */}
        {isAuthenticated && (
          <header className="app-header">
            <div className="header-content">
              <div className="logo">
                <h1>🏃‍♂️ My Errand</h1>
              </div>
              <nav className="main-nav">
                <ul>
                  <li><Link to="/" className={location.pathname === '/' ? 'active' : ''}>Home</Link></li>
                  <li><Link to="/errands" className={location.pathname === '/errands' ? 'active' : ''}>Errands</Link></li>
                  <li><Link to="/pay" className={location.pathname === '/pay' ? 'active' : ''}>Pay Now</Link></li>
                  <li><Link to="/profile" className={location.pathname === '/profile' ? 'active' : ''}>Profile</Link></li>
                </ul>
              </nav>
              <div className="user-info">
                <div className="balance-info">
                  <span className="balance-item">💰 Spendable: ${Number(userBalances.spendable || 0).toFixed(2)}</span>
                  <span className="balance-item">💳 Withdrawable: ${Number(userBalances.withdrawable || 0).toFixed(2)}</span>
                  <span className="balance-item">🔒 Escrow: ${Number(userBalances.escrow || 0).toFixed(2)}</span>
                </div>
                <span className="username">👤 {user?.name || 'User'}</span>
                <NotificationBell />
                <button onClick={handleLogout} className="logout-btn">🚪 Logout</button>
                <CurrencySwitcher />
                <LanguageSwitcher />
              </div>
            </div>
          </header>
        )}

        <main className="main-content">
          {isAuthenticated && (
            <div className="page-header">
              <h2>{getPageTitle()}</h2>
            </div>
          )}

          <div className={isAuthenticated ? "container" : ""}>
            <Suspense fallback={
              <div className="loading-container">
                <h2>🏃‍♂️ Loading...</h2>
                <p>Please wait while we load the page</p>
              </div>
            }>
              <Routes>
                {/* Public routes */}
                <Route path="/login" element={<Login onLogin={setUser} />} />
                <Route path="/register" element={<UserTypeSelection />} />
                <Route path="/register/client" element={<RegisterClient />} />
                <Route path="/register/runner" element={<RegisterRunner />} />

                {/* Protected routes */}
                <Route path="/" element={
                  <ProtectedRoute isAuthenticated={isAuthenticated}>
                    {user?.userType === 'client' ? (
                      <ClientDashboard
                        errands={errands}
                        user={user}
                        balances={userBalances}
                        onAddErrand={addErrand}
                        onUpdateStatus={updateErrandStatus}
                      />
                    ) : user?.userType === 'runner' ? (
                      <RunnerDashboard
                        errands={errands}
                        user={user}
                        onAddErrand={addErrand}
                        onUpdateStatus={updateErrandStatus}
                      />
                    ) : (user?.userType === 'admin' || user?.user_type === 'admin') ? (
                      <AdminDashboard user={user} />
                    ) : (
                      <Home
                        errands={errands}
                        user={user}
                        onAddErrand={addErrand}
                        onUpdateStatus={updateErrandStatus}
                      />
                    )}
                  </ProtectedRoute>
                } />
                <Route path="/errands" element={
                  <ProtectedRoute isAuthenticated={isAuthenticated}>
                    <ErrandList
                      errands={errands}
                      onAddErrand={addErrand}
                      onUpdateStatus={updateErrandStatus}
                    />
                  </ProtectedRoute>
                } />
                <Route path="/pay" element={
                  <ProtectedRoute isAuthenticated={isAuthenticated}>
                    <PayNow user={user} setUser={setUser} />
                  </ProtectedRoute>
                } />
                <Route path="/admin" element={<ProtectedRoute isAuthenticated={isAuthenticated}><AdminDashboard user={user} /></ProtectedRoute>} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/profile" element={
                  <ProtectedRoute isAuthenticated={isAuthenticated}>
                    <Profile user={user} setUser={setUser} />
                  </ProtectedRoute>
                } />
              </Routes>
            </Suspense>
          </div>
        </main>

        {isAuthenticated && (
          <footer className="app-footer">
            <p>&copy; 2025 My Errand. All rights reserved. | Built with React & Node.js</p>
          </footer>
        )}
      </div>
    </TranslationProvider>
  )
}

export default App
