import React, { useState, useEffect } from 'react'
import { toast } from 'react-toastify'
import { apiUrl } from '../api'

function Profile({ user, setUser }) {
  const [isEditing, setIsEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState('')
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [pwLoading, setPwLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    address: user?.address || '',
    userType: user?.userType || user?.user_type || 'client'
  })

  useEffect(() => {
    const loadStats = async () => {
      setStatsLoading(true)
      setStatsError('')
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(apiUrl('/api/auth/stats'), {
          headers: { Authorization: `Bearer ${token}` }
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load stats')
        setStats(data.stats || data)
      } catch (e) {
        setStatsError(e.message || 'Could not load statistics')
      } finally {
        setStatsLoading(false)
      }
    }
    loadStats()
  }, [])

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(apiUrl('/api/auth/profile'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      })
      const data = await response.json()
      if (response.ok) {
        const updatedUser = { ...user, ...formData }
        setUser(updatedUser)
        localStorage.setItem('user', JSON.stringify(updatedUser))
        setIsEditing(false)
        toast.success('Profile updated successfully!')
      } else {
        toast.error(data.error || data.message || 'Failed to update profile')
      }
    } catch (error) {
      toast.error('Network error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      toast.error('New passwords do not match')
      return
    }
    if (pwForm.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setPwLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(apiUrl('/api/auth/change-password'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          currentPassword: pwForm.currentPassword,
          newPassword: pwForm.newPassword
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to change password')
      toast.success(data.message || 'Password changed')
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setPwLoading(false)
    }
  }

  const handleDeactivate = async () => {
    if (!window.confirm('Deactivate your account? You will not be able to sign in.')) return
    const confirm = window.prompt('Type DELETE to confirm')
    if (confirm !== 'DELETE') return
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(apiUrl('/api/auth/deactivate'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ confirm: 'DELETE' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      toast.success(data.message || 'Account deactivated')
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    } catch (e) {
      toast.error(e.message)
    }
  }

  const memberSince = stats?.memberSince
    ? new Date(stats.memberSince).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
    : '—'
  const ratingLabel = stats?.rating != null ? `${stats.rating}/5.0` : 'No ratings yet'
  const earningsLabel =
    formData.userType === 'runner'
      ? `$${(stats?.totalEarnings ?? 0).toFixed(2)}`
      : `$${(stats?.totalSpent ?? 0).toFixed(2)}`
  const earningsTitle = formData.userType === 'runner' ? 'Total Earnings' : 'Total Spent'
  const tasksLabel = String(stats?.completedTasks ?? 0)


  const handleDownloadData = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(apiUrl('/api/auth/download-data'), {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Export failed')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `my-errand-data-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Data download started')
    } catch (e) {
      toast.error(e.message)
    }
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <h2>My Profile</h2>
        {!isEditing && (
          <button className="btn btn-primary" onClick={() => setIsEditing(true)}>Edit Profile</button>
        )}
      </div>

      <div className="profile-section">
        <h4>Account Details</h4>
        {isEditing ? (
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label>Name</label>
              <input name="name" value={formData.name} onChange={handleInputChange} required />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input name="email" type="email" value={formData.email} onChange={handleInputChange} required />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input name="phone" value={formData.phone || ''} onChange={handleInputChange} />
            </div>
            <div className="form-group">
              <label>Address</label>
              <input name="address" value={formData.address || ''} onChange={handleInputChange} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={isLoading}>
              {isLoading ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn" onClick={() => setIsEditing(false)}>Cancel</button>
          </form>
        ) : (
          <div className="profile-details">
            <div className="detail-item"><label>Name:</label><span>{formData.name}</span></div>
            <div className="detail-item"><label>Email:</label><span>{formData.email}</span></div>
            <div className="detail-item"><label>Phone:</label><span>{formData.phone || '—'}</span></div>
            <div className="detail-item"><label>Address:</label><span>{formData.address || '—'}</span></div>
            <div className="detail-item"><label>Role:</label><span>{formData.userType}</span></div>
          </div>
        )}
      </div>

      <div className="profile-section">
        <h4>Account Statistics</h4>
        {statsLoading && <p>Loading statistics…</p>}
        {statsError && <p className="error">{statsError}</p>}
        {!statsLoading && !statsError && (
          <div className="stats-grid">
            <div className="stat-item">
              <div className="stat-content">
                <span className="stat-label">Member Since</span>
                <span className="stat-value">{memberSince}</span>
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-content">
                <span className="stat-label">Rating</span>
                <span className="stat-value">{ratingLabel}</span>
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-content">
                <span className="stat-label">{earningsTitle}</span>
                <span className="stat-value">{earningsLabel}</span>
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-content">
                <span className="stat-label">Tasks Completed</span>
                <span className="stat-value">{tasksLabel}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="profile-section">
        <h4>Change Password</h4>
        <form onSubmit={handleChangePassword}>
          <div className="form-group">
            <label>Current password</label>
            <input type="password" value={pwForm.currentPassword}
              onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>New password</label>
            <input type="password" value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} required minLength={8} />
          </div>
          <div className="form-group">
            <label>Confirm new password</label>
            <input type="password" value={pwForm.confirmPassword}
              onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })} required minLength={8} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={pwLoading}>
            {pwLoading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>

      <div className="profile-section">
        <h4>Danger zone</h4>
        <button type="button" className="btn" onClick={handleDownloadData}>Download my data</button>
        <button type="button" className="btn" onClick={handleDeactivate} style={{ marginLeft: 8 }}>Deactivate account</button>
      </div>
    </div>
  )
}

export default Profile
