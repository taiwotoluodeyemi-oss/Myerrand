import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { apiUrl } from '../api'
import './Auth.css'

function RegisterRunner() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    vehicleType: 'none',
    areasOfService: '',
    availableHours: '',
    preferredErrandTypes: [],
    insuranceCoverage: false,
    emergencyContactName: '',
    emergencyContactPhone: '',
    termsAccepted: false,
    privacyAccepted: false,
    smsNotifications: true
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
      preferredErrandTypes: prev.preferredErrandTypes.includes(errandType)
        ? prev.preferredErrandTypes.filter(type => type !== errandType)
        : [...prev.preferredErrandTypes, errandType]
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
        userType: 'runner',
        preferredErrandTypes: formData.preferredErrandTypes.join(',')
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

      setSuccess('Runner account created successfully! Redirecting to login...')

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
          <h1>🚀 Runner Registration</h1>
          <p>Get ready to start completing errands</p>
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

          <div className="form-section">
            <h3>Runner Details</h3>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="vehicleType">Vehicle Type</label>
                <select
                  id="vehicleType"
                  name="vehicleType"
                  value={formData.vehicleType}
                  onChange={handleChange}
                >
                  <option value="none">No Vehicle</option>
                  <option value="bike">Bicycle</option>
                  <option value="scooter">Scooter</option>
                  <option value="car">Car</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="areasOfService">Areas of Service</label>
                <input
                  type="text"
                  id="areasOfService"
                  name="areasOfService"
                  value={formData.areasOfService}
                  onChange={handleChange}
                  placeholder="Neighborhoods or areas you cover"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="availableHours">Available Working Hours</label>
              <input
                type="text"
                id="availableHours"
                name="availableHours"
                value={formData.availableHours}
                onChange={handleChange}
                placeholder="e.g., Weekdays after 5 PM, Full-time weekends"
              />
            </div>

            <div className="form-group">
              <label>Preferred Errand Types</label>
              <div className="checkbox-grid">
                {errandTypes.map(type => (
                  <label key={type} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.preferredErrandTypes.includes(type)}
                      onChange={() => handleErrandTypeChange(type)}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="insuranceCoverage"
                  checked={formData.insuranceCoverage}
                  onChange={handleChange}
                />
                <span>I have liability insurance coverage</span>
              </label>
            </div>
          </div>

          <div className="form-section">
            <h3>Emergency Contact</h3>

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
                <label htmlFor="emergencyContactPhone">Emergency Contact Phone</label>
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
              <span>I want to receive SMS notifications about errand requests</span>
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
                Creating runner account...
              </span>
            ) : (
              'Create Runner Account'
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Want to be a client instead?{' '}
            <Link to="/register/client" className="auth-link">
              Sign up as Client
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

export default RegisterRunner
