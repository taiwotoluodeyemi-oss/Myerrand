import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { apiUrl } from '../api'
import './Auth.css'

function Login({ onLogin }) {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
    // Clear error when user starts typing
    if (error) setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      // Call the API
      const response = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
      })

      let data
      try {
        data = await response.json()
      } catch (_) {
        // If response isn't JSON
        data = { error: 'Unexpected server response' }
      }

      if (!response.ok) {
        const msg = data?.error || `Login failed (status ${response.status})`
        throw new Error(msg)
      }

      // Store the token
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))

      // Call the parent component's login handler if provided
      if (typeof onLogin === 'function') {
        onLogin(data.user)
      }

      // Navigate to dashboard
      navigate('/')
    } catch (err) {
      setError(err?.message || 'Login failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDemoLogin = async () => {
    setIsLoading(true)
    setError('')

    try {
      // Call the demo login API
      const response = await fetch(apiUrl('/api/auth/demo-login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Demo login failed')
      }

      // Store the token
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))

      // Call the parent component's login handler
      onLogin(data.user)

      // Navigate to dashboard
      navigate('/')
    } catch (err) {
      setError(err.message || 'Demo login failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>🏃‍♂️ My Errand</h1>
          {/* <h2>Welcome Back</h2> */}
          <p>Sign in to your account to continue</p>
        </div>

        {error && (
          <div className="error-message">
            <span>❌</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="Enter your email"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
            />
          </div>

          <button 
            type="submit" 
            className="auth-button"
            disabled={isLoading}
          >
            {isLoading ? (
              <span>
                <span className="spinner">⏳</span>
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Don't have an account?{' '}
            <Link to="/forgot-password" className="auth-link">Forgot password?</Link>
            <Link to="/register" className="auth-link">
              Sign up here
            </Link>
          </p>
        </div>

        {/* <div className="demo-info">
          <h4>Demo Account</h4>
          <p><strong>Email:</strong> demo@example.com</p>
          <p><strong>Password:</strong> demo123</p>
          <button 
            type="button" 
            onClick={handleDemoLogin}
            className="demo-login-btn"
            disabled={isLoading}
          >
            🎮 Try Demo Login
          </button>
        </div> */}
      </div>
    </div>
  )
}

export default Login
