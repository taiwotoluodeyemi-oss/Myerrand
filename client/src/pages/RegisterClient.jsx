import React, { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { apiUrl } from '../api'
import { detectCurrency } from '../utils/localeCurrency'
import './Auth.css'

const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT - Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara'
]

// Budget options: value is always a number for DECIMAL column; labels depend on currency
const BUDGET_OPTIONS_USD = [
  { value: '25', label: 'Under $25' },
  { value: '50', label: '$25 – $50' },
  { value: '100', label: '$50 – $100' },
  { value: '200', label: '$100 – $200' },
  { value: '500', label: 'Over $200' },
]

const BUDGET_OPTIONS_NGN = [
  { value: '10000', label: 'Under ₦10,000' },
  { value: '25000', label: '₦10,000 – ₦25,000' },
  { value: '50000', label: '₦25,000 – ₦50,000' },
  { value: '100000', label: '₦50,000 – ₦100,000' },
  { value: '250000', label: 'Over ₦100,000' },
]

function RegisterClient() {
  const [formData, setFormData] = useState({
    // Basic Information
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',

    // Location – standard Address 1, Address 2, City, State, Postal
    address1: '',
    address2: '',
    city: '',
    state: '',
    zipCode: '',
    preferredContactMethod: 'phone',

    // Preferences
    typicalErrands: [],
    maxBudgetPerErrand: '',
    specialInstructions: '',

    // Emergency contact – separate name and number
    emergencyContactName: '',
    emergencyContactPhone: '',

    // Agreements
    termsAccepted: false,
    privacyAccepted: false,
    smsNotifications: false
  })

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const navigate = useNavigate()

  const currency = useMemo(() => {
    try {
      const c = detectCurrency()
      // Prefer NGN when browser locale is Nigeria-related or phone looks Nigerian
      if (c === 'NGN') return 'NGN'
      if (typeof navigator !== 'undefined') {
        const loc = (navigator.language || '').toLowerCase()
        if (loc.includes('-ng') || loc === 'en-ng') return 'NGN'
      }
      return c || 'USD'
    } catch (_) {
      return 'USD'
    }
  }, [])

  // If user enters a Nigerian phone (starts with 0 or +234), treat budget as NGN
  const effectiveCurrency = useMemo(() => {
    const phone = (formData.phone || '').replace(/\s/g, '')
    if (/^(\+?234|0)[789]/.test(phone)) return 'NGN'
    return currency
  }, [currency, formData.phone])

  const budgetOptions = effectiveCurrency === 'NGN' ? BUDGET_OPTIONS_NGN : BUDGET_OPTIONS_USD

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

  const validatePassword = (password) => {
    if (password.length < 8) {
      return 'Password must be at least 8 characters long'
    }
    if (!/[A-Z]/.test(password)) {
      return 'Password must include at least one uppercase letter'
    }
    if (!/[a-z]/.test(password)) {
      return 'Password must include at least one lowercase letter'
    }
    if (!/[0-9]/.test(password)) {
      return 'Password must include at least one number'
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      return 'Password must include at least one special character (!@#$%^&* etc.)'
    }
    return null
  }

  const validateForm = () => {
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return false
    }
    const pwdErr = validatePassword(formData.password)
    if (pwdErr) {
      setError(pwdErr)
      return false
    }
    if (!formData.address1.trim()) {
      setError('Address line 1 is required')
      return false
    }
    if (!formData.city.trim()) {
      setError('City is required')
      return false
    }
    if (!formData.state) {
      setError('Please select a state')
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
    if (!formData.phone.match(/^\+?[\d\s\-()]{10,}$/)) {
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
      // Combine address fields for backend (schema has single address + city + zip)
      const addressParts = [
        formData.address1.trim(),
        formData.address2.trim(),
        formData.state
      ].filter(Boolean)
      const combinedAddress = addressParts.join(', ')

      // Combine emergency contact name + phone
      const emergencyContacts = [formData.emergencyContactName, formData.emergencyContactPhone]
        .map(s => (s || '').trim())
        .filter(Boolean)
        .join(' | ') || null

      // Numeric budget for DECIMAL column
      const maxBudget = formData.maxBudgetPerErrand
        ? parseFloat(formData.maxBudgetPerErrand)
        : null

      const registrationData = {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        phone: formData.phone,
        userType: 'client',
        address: combinedAddress,
        city: formData.city,
        zipCode: formData.zipCode || null,
        preferredContactMethod: formData.preferredContactMethod,
        typicalErrands: formData.typicalErrands.join(','),
        maxBudgetPerErrand: Number.isFinite(maxBudget) ? maxBudget : null,
        specialInstructions: formData.specialInstructions || null,
        emergencyContacts,
        emergencyContactName: formData.emergencyContactName || null,
        emergencyContactPhone: formData.emergencyContactPhone || null,
        smsNotifications: formData.smsNotifications,
        termsAccepted: formData.termsAccepted,
        privacyAccepted: formData.privacyAccepted
      }

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
                  autoComplete="name"
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
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
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
                placeholder="e.g. 08012345678 or +2348012345678"
                required
                autoComplete="tel"
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
                  placeholder="Min. 8 chars, upper, lower, number, special"
                  required
                  minLength="8"
                  autoComplete="new-password"
                />
                <small className="field-hint">
                  At least 8 characters, with uppercase, lowercase, a number, and a special character (!@#$%^&* etc.)
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password *</label>
                <input
                  type="password"
                  id="confirmPassword"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="Re-enter your password"
                  required
                  minLength="8"
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>

          {/* Address / Location – standard layout */}
          <div className="form-section">
            <h3>Address / Location Information</h3>

            <div className="form-group">
              <label htmlFor="address1">Address Line 1 *</label>
              <input
                type="text"
                id="address1"
                name="address1"
                value={formData.address1}
                onChange={handleChange}
                placeholder="Street address, house number, estate"
                required
                autoComplete="address-line1"
              />
            </div>

            <div className="form-group">
              <label htmlFor="address2">Address Line 2</label>
              <input
                type="text"
                id="address2"
                name="address2"
                value={formData.address2}
                onChange={handleChange}
                placeholder="Apartment, suite, landmark (optional)"
                autoComplete="address-line2"
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="city">City / LGA *</label>
                <input
                  type="text"
                  id="city"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  placeholder="City or Local Government Area"
                  required
                  autoComplete="address-level2"
                />
              </div>

              <div className="form-group">
                <label htmlFor="state">State *</label>
                <select
                  id="state"
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select state</option>
                  {NIGERIA_STATES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="zipCode">Postal / ZIP Code</label>
              <input
                type="text"
                id="zipCode"
                name="zipCode"
                value={formData.zipCode}
                onChange={handleChange}
                placeholder="Optional"
                autoComplete="postal-code"
              />
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
                <label htmlFor="maxBudgetPerErrand">
                  Typical Budget Per Errand
                  {effectiveCurrency === 'NGN' ? ' (₦)' : ' ($)'}
                </label>
                <select
                  id="maxBudgetPerErrand"
                  name="maxBudgetPerErrand"
                  value={formData.maxBudgetPerErrand}
                  onChange={handleChange}
                >
                  <option value="">Select budget range</option>
                  {budgetOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
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
                placeholder="Gate code, accessibility needs, preferred times, etc."
                rows="3"
              />
            </div>

            {/* Emergency contact – separate name and number */}
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="emergencyContactName">Emergency Contact Name</label>
                <input
                  type="text"
                  id="emergencyContactName"
                  name="emergencyContactName"
                  value={formData.emergencyContactName}
                  onChange={handleChange}
                  placeholder="Full name"
                />
              </div>
              <div className="form-group">
                <label htmlFor="emergencyContactPhone">Emergency Contact Number</label>
                <input
                  type="tel"
                  id="emergencyContactPhone"
                  name="emergencyContactPhone"
                  value={formData.emergencyContactPhone}
                  onChange={handleChange}
                  placeholder="Phone number"
                />
              </div>
            </div>
          </div>

          {/* Agreements – aligned */}
          <div className="form-section agreements">
            <h3>Agreements</h3>
            <label className="checkbox-label required">
              <input
                type="checkbox"
                name="termsAccepted"
                checked={formData.termsAccepted}
                onChange={handleChange}
                required
              />
              <span>I accept the <Link to="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</Link> *</span>
            </label>

            <label className="checkbox-label required">
              <input
                type="checkbox"
                name="privacyAccepted"
                checked={formData.privacyAccepted}
                onChange={handleChange}
                required
              />
              <span>I accept the <Link to="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</Link> *</span>
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
