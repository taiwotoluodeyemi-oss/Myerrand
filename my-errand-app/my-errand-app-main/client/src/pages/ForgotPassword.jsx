import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import './Auth.css'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const requestReset = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    try {
      const res = await axios.post('/api/auth/forgot-password', { email })
      setMessage(res.data.message || 'If that email exists, a reset was issued.')
      // Dev convenience: show token when returned
      if (res.data.resetToken) setToken(res.data.resetToken)
    } catch (err) {
      setError(err.response?.data?.error || 'Request failed')
    }
  }

  const doReset = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await axios.post('/api/auth/reset-password', { token, newPassword })
      setMessage(res.data.message || 'Password updated. You can sign in.')
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed')
    }
  }

  return (
    <div className="auth-container">
      <h2>Forgot password</h2>
      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
      <form onSubmit={requestReset}>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button type="submit">Send reset</button>
      </form>
      <hr />
      <form onSubmit={doReset}>
        <label>Reset token</label>
        <input value={token} onChange={(e) => setToken(e.target.value)} required />
        <label>New password</label>
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        <button type="submit">Reset password</button>
      </form>
      <p><Link to="/login">Back to login</Link></p>
    </div>
  )
}
