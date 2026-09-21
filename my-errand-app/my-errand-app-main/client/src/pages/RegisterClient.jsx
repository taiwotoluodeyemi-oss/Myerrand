import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { apiUrl } from '../api'
import './Auth.css'

function RegisterClient() {
  const [formData, setFormData] = useState({
    // Basic Information
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',

    // Client-specific Information
    address: '',
    city: '',
    zipCode: '',
    preferredContactMethod: 'phone',

    // Preferences
    typicalErrands: [],
    maxBudgetPerErrand: '',
    emergencyContacts: '',
    specialInstructions: '',

    // Agreement checkboxes
    termsAccepted: false,
    privacyAccepted: false,
    smsNotifications: false
  })

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const navigate = useNavigate()

  const errandTypes = [
    'Grocery Shopping',
    'Package Delivery',
    'Pet Care',
    'House Cleaning',
    'Laundry Service',
    'Elderly Care',
    'Transportation',
    'Home Maintenance',
    'Document Processing',
    'Other'
  ]

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))

    if (error) setError('')
    if (success) setSuccess('')
  }

  const handleErrandTypeChange = (errandType) => {
    setFormData(prev => ({
      ...prev,
      typicalErrands: prev.typicalErrands.includes(errandType)
        ? prev.typicalErrands.filter(type => type !== errandType)
        : [...prev.typicalErrands, errandType]
    }))
  }

  const validateForm = () => {
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return false
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long')
      return false
    }
    if (!formData.termsAccepted) {
      setError('You must accept the Terms of Service')
      return false
    }
    if (!formData.privacyAccepted) {
      setError('You must accept the Privacy Policy')
      return false
    }
    if (!formData.phone.match(/^\+?[\d\s\-\(\)]{10,}$/)) {
      setError('Please enter a valid phone number')
      return false
    }
    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess('')

    if (!validateForm()) {
      setIsLoading(false)
      return
    }

    try {
      const registrationData = {
        ...formData,
        userType: 'client',
        typicalErrands: formData.typicalErrands.join(',')
      }

      delete registrationData.confirmPassword

      const response = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registrationData)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed')
      }

      setSuccess('Client account created successfully! Redirecting to login...')

      setTimeout(() => {
        navigate('/login')
      }, 2000)

    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="auth-container">
      <div className="auth-card register-card">
        <div className="auth-header">
          <h1>🛒 Client Registration</h1>
          <p>Get help with your daily errands</p>
        </div>

        {error && (
          <div className="error-message">
            <span>❌</span>
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="success-message">
            <span>✅</span>
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          {/* Basic Information */}
          <div className="form-section">
            <h3>Basic Information</h3>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="name">Full Name *</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Enter your full name"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email Address *</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="Enter your email"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="phone">Phone Number *</label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="Enter your phone number"
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="password">Password *</label>
                <input
                  type="password"
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Create a password (min. 6 characters)"
                  required
                  minLength="6"
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password *</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="Confirm your password"
                  required
                />
              </div>
            </div>
          </div>

          {/* Location Information */}
          <div className="form-section">
            <h3>Location Information</h3>

            <div className="form-group">
              <label htmlFor="address">Address *</label>
              <input
                type="text"
                id="address"
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="Enter your street address"
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="city">City *</label>
                <input
                  type="text"
                  id="city"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  placeholder="Enter your city"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="zipCode">ZIP Code *</label>
                <input
                  type="text"
                  id="zipCode"
                  name="zipCode"
                  value={formData.zipCode}
                  onChange={handleChange}
                  placeholder="Enter ZIP code"
                  required
                />
              </div>
            </div>
          </div>

          {/* Preferences */}
          <div className="form-section">
            <h3>Your Preferences</h3>

            <div className="form-group">
              <label>What types of errands do you typically need help with?</label>
              <div className="checkbox-grid">
                {errandTypes.map(type => (
                  <label key={type} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.typicalErrands.includes(type)}
                      onChange={() => handleErrandTypeChange(type)}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="maxBudgetPerErrand">Typical Budget Per Errand</label>
                <select
                  id="maxBudgetPerErrand"
                  name="maxBudgetPerErrand"
                  value={formData.maxBudgetPerErrand}
                  onChange={handleChange}
                >
                  <option value="">Select budget range</option>
                  <option value="under-25">Under $25</option>
                  <option value="25-50">$25 - $50</option>
                  <option value="50-100">$50 - $100</option>
                  <option value="100-200">$100 - $200</option>
                  <option value="over-200">Over $200</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="preferredContactMethod">Preferred Contact Method</label>
                <select
                  id="preferredContactMethod"
                  name="preferredContactMethod"
                  value={formData.preferredContactMethod}
                  onChange={handleChange}
                >
                  <option value="phone">Phone Call</option>
                  <option value="sms">Text Message</option>
                  <option value="email">Email</option>
                  <option value="app">App Notifications</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="specialInstructions">Special Instructions or Accessibility Needs</label>
              <textarea
                id="specialInstructions"
                name="specialInstructions"
                value={formData.specialInstructions}
                onChange={handleChange}
                placeholder="Any special instructions for errand runners (e.g., gate code, accessibility needs, preferred delivery times)"
                rows="3"
              />
            </div>

            <div className="form-group">
              <label htmlFor="emergencyContacts">Emergency Contact (Optional)</label>
              <input
                type="text"
                id="emergencyContacts"
                name="emergencyContacts"
                value={formData.emergencyContacts}
                onChange={handleChange}
                placeholder="Name and phone number of emergency contact"
              />
            </div>
          </div>

          {/* Agreements */}
          <div className="form-section agreements">
            <label className="checkbox-label required">
              <input
                type="checkbox"
                name="termsAccepted"
                checked={formData.termsAccepted}
                onChange={handleChange}
                required
              />
              <span>I accept the <Link to="/terms" target="_blank">Terms of Service</Link> *</span>
            </label>

            <label className="checkbox-label required">
              <input
                type="checkbox"
                name="privacyAccepted"
                checked={formData.privacyAccepted}
                onChange={handleChange}
                required
              />
              <span>I accept the <Link to="/privacy" target="_blank">Privacy Policy</Link> *</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                name="smsNotifications"
                checked={formData.smsNotifications}
                onChange={handleChange}
              />
              <span>I want to receive SMS notifications about my errands</span>
            </label>
          </div>

          <button
            type="submit"
            className="auth-button"
            disabled={isLoading}
          >
            {isLoading ? (
              <span>
                <span className="spinner">⏳</span>
                Creating client account...
              </span>
            ) : (
              'Create Client Account'
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Want to be an errand runner instead?{' '}
            <Link to="/register/runner" className="auth-link">
              Sign up as Runner
            </Link>
          </p>
          <p>
            Already have an account?{' '}
            <Link to="/login" className="auth-link">
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default RegisterClient
