import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import './Auth.css'

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1) // 1=email, 2=token+password
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const requestReset = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)
    try {
      const res = await axios.post('/api/auth/forgot-password', { email })
      setMessage(res.data.message || 'If that email exists, a reset token was sent to your email.')
      if (res.data.resetToken) setToken(res.data.resetToken)
      setStep(2)
    } catch (err) {
      setError(err.response?.data?.error || 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  const doReset = async (e) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      const res = await axios.post('/api/auth/reset-password', { token, newPassword })
      setMessage(res.data.message || 'Password updated successfully. Redirecting to login...')
      setTimeout(() => navigate('/login'), 2000)
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: 420, margin: '0 auto', padding: 24 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 8 }}>Forgot Password</h2>
        <p style={{ textAlign: 'center', color: '#666', marginBottom: 20 }}>
          {step === 1 ? 'Enter your email to receive a reset token' : 'Enter the token and set a new password'}
        </p>
        {message && <p className="success" style={{ textAlign: 'center' }}>{message}</p>}
        {error && <p className="error" style={{ textAlign: 'center' }}>{error}</p>}

        {step === 1 && (
          <form onSubmit={requestReset} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontWeight: 500 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ccc' }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 8,
                padding: '12px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer'
              }}
            >
              {loading ? 'Sending...' : 'Send Reset Token'}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={doReset} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontWeight: 500 }}>Reset Token</label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              placeholder="Paste the token from your email"
              style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ccc' }}
            />
            <label style={{ fontWeight: 500 }}>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              placeholder="At least 8 characters"
              style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ccc' }}
            />
            <label style={{ fontWeight: 500 }}>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Re-enter new password"
              style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid #ccc' }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 8,
                padding: '12px',
                background: '#16a34a',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer'
              }}
            >
              {loading ? 'Updating...' : 'Reset Password'}
            </button>
            <button
              type="button"
              onClick={() => { setStep(1); setError(''); setMessage('') }}
              style={{
                padding: '8px',
                background: 'transparent',
                border: '1px solid #ccc',
                borderRadius: 6,
                cursor: 'pointer'
              }}
            >
              ← Back to email
            </button>
          </form>
        )}

        <p style={{ textAlign: 'center', marginTop: 20 }}>
          <Link to="/login">Back to Login</Link>
        </p>
      </div>
    </div>
  )
}
