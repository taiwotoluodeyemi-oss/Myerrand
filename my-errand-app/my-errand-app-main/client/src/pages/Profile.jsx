import React, { useState } from 'react'
import { toast } from 'react-toastify'
import { apiUrl } from '../api'

function Profile({ user, setUser }) {
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: user.name,
    email: user.email,
    phone: user.phone,
    address: user.address,
    userType: user.userType
  })

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const token = localStorage.getItem('token')
      if (!token) {
        toast.error('Authentication required. Please log in again.')
        return
      }

      const response = await fetch(apiUrl('/api/auth/profile'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })

      const data = await response.json()

      if (response.ok) {
        // Update user context with new data
        const updatedUser = {
          ...user,
          ...formData
        }
        setUser(updatedUser)

        // Update localStorage with new user data
        localStorage.setItem('user', JSON.stringify(updatedUser))

        setIsEditing(false)
        toast.success('Profile updated successfully!')
      } else {
        toast.error(data.message || 'Failed to update profile')
      }
    } catch (error) {
      console.error('Profile update error:', error)
      toast.error('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCancel = () => {
    setFormData({
      name: user.name,
      email: user.email,
      phone: user.phone,
      address: user.address
    })
    setIsEditing(false)
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div className="profile-avatar">
          <div className="avatar-circle">
            {user.name.charAt(0).toUpperCase()}
          </div>
        </div>
        <div className="profile-info">
          <h3>{user.name}</h3>
          <p className="profile-role">{user.userType === 'runner' ? 'Runner' : 'Client'}</p>
          <p className="profile-balance">Current Balance: <strong>${Number(user.balance || 0).toFixed(2)}</strong></p>
        </div>
      </div>

      <div className="profile-content">
        <div className="profile-section">
          <div className="section-header">
            <h4>Personal Information</h4>
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="button secondary small"
              >
                Edit Profile
              </button>
            )}
          </div>

          {isEditing ? (
            <form onSubmit={handleSave} className="profile-form">
              <div className="form-group">
                <label htmlFor="name">Full Name</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="phone">Phone Number</label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                />
              </div>

              <div className="form-group">
                <label htmlFor="address">Address</label>
                <textarea
                  id="address"
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  rows="2"
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="button success" disabled={isLoading}>
                  {isLoading ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="button secondary"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="profile-details">
              <div className="detail-item">
                <label>Full Name:</label>
                <span>{user.name}</span>
              </div>
              <div className="detail-item">
                <label>Email:</label>
                <span>{formData.email}</span>
              </div>
              <div className="detail-item">
                <label>Phone:</label>
                <span>{formData.phone}</span>
              </div>
              <div className="detail-item">
                <label>Address:</label>
                <span>{formData.address}</span>
              </div>
            </div>
          )}
        </div>

        <div className="profile-section">
          <h4>Account Statistics</h4>
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-icon">👤</div>
              <div className="stat-content">
                <span className="stat-label">Member Since</span>
                <span className="stat-value">January 2025</span>
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-icon">⭐</div>
              <div className="stat-content">
                <span className="stat-label">Rating</span>
                <span className="stat-value">4.8/5.0</span>
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-icon">🏆</div>
              <div className="stat-content">
                <span className="stat-label">Total Earnings</span>
                <span className="stat-value">$1,245.50</span>
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-icon">📈</div>
              <div className="stat-content">
                <span className="stat-label">Tasks Completed</span>
                <span className="stat-value">87</span>
              </div>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <h4>Account Settings</h4>
          <div className="settings-options">
            <div className="setting-item">
              <span>Email Notifications</span>
              <label className="toggle">
                <input type="checkbox" defaultChecked />
                <span className="slider"></span>
              </label>
            </div>
            <div className="setting-item">
              <span>Push Notifications</span>
              <label className="toggle">
                <input type="checkbox" defaultChecked />
                <span className="slider"></span>
              </label>
            </div>
            <div className="setting-item">
              <span>SMS Alerts</span>
              <label className="toggle">
                <input type="checkbox" />
                <span className="slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <h4>Actions</h4>
          <div className="action-buttons">
            <button className="button primary">Download Data</button>
            <button className="button secondary">Change Password</button>
            <button className="button danger">Delete Account</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Profile
