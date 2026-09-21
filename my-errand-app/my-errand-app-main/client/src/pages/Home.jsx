import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from '../contexts/TranslationContext'

function Home({ errands = [], user = {}, onAddErrand, onUpdateStatus }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  
  // Safety checks for props
  const safeErrands = Array.isArray(errands) ? errands : []
  const safeUser = user || { name: 'User', balance: 0 }
  
  const pendingErrands = safeErrands.filter(e => e.status === 'pending')
  const inProgressErrands = safeErrands.filter(e => e.status === 'in-progress')
  const completedErrands = safeErrands.filter(e => e.status === 'completed')
  
  const totalEarnings = completedErrands.reduce((sum, errand) => sum + (parseFloat(errand.amount) || 0), 0)

  const handleQuickStart = () => {
    const newErrand = {
      title: 'Quick Task',
      description: 'A quick errand task',
      amount: 10.00
    }
    onAddErrand(newErrand)
  }

  const handleAddErrand = () => {
    navigate('/errands')
  }

  const handleFindErrands = () => {
    navigate('/errands')
  }

  const handleViewReports = () => {
    // For now, show an alert with stats
    const stats = {
      total: errands.length,
      pending: pendingErrands.length,
      inProgress: inProgressErrands.length,
      completed: completedErrands.length,
      earnings: totalEarnings
    }
    
    alert(`📊 Quick Report:\n\n` +
          `Total Errands: ${stats.total}\n` +
          `Pending: ${stats.pending}\n` +
          `In Progress: ${stats.inProgress}\n` +
          `Completed: ${stats.completed}\n` +
          `Total Earnings: $${Number(stats.earnings || 0).toFixed(2)}`)
  }

  const handleSettings = () => {
    navigate('/profile')
  }

  const handleStatCardClick = (filter = 'all') => {
    navigate(`/errands${filter !== 'all' ? `?filter=${filter}` : ''}`)
  }

  return (
    <div className="home-page">
      <div className="welcome-section">
        <div className="welcome-header">
          <div className="welcome-text">
            <h3>{t('welcome')} back, {safeUser.name}! 👋</h3>
            <p>Ready to tackle some errands today?</p>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📋</div>
          <div className="stat-content">
            <h4>Total Errands</h4>
            <p className="stat-number">{safeErrands.length}</p>
          </div>
        </div>
        
        <div className="stat-card pending">
          <div className="stat-icon">⏳</div>
          <div className="stat-content">
            <h4>Pending</h4>
            <p className="stat-number">{pendingErrands.length}</p>
          </div>
        </div>
        
        <div className="stat-card in-progress">
          <div className="stat-icon">🚀</div>
          <div className="stat-content">
            <h4>In Progress</h4>
            <p className="stat-number">{inProgressErrands.length}</p>
          </div>
        </div>
        
        <div className="stat-card completed">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h4>Completed</h4>
            <p className="stat-number">{completedErrands.length}</p>
          </div>
        </div>
        
        <div className="stat-card earnings">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h4>Earnings</h4>
            <p className="stat-number">${totalEarnings.toFixed(2)}</p>
          </div>
        </div>
        
        <div className="stat-card balance">
          <div className="stat-icon">💳</div>
          <div className="stat-content">
            <h4>Balance</h4>
            <p className="stat-number">${Number(safeUser.balance || 0).toFixed(2)}</p>
          </div>
        </div>
      </div>

      <div className="recent-errands">
        <h3>Recent Errands</h3>
        {safeErrands.length === 0 ? (
          <div className="no-errands">
            <p>No errands yet. Get started by creating your first errand!</p>
            <button onClick={handleQuickStart} className="button">
              Create Quick Errand
            </button>
          </div>
        ) : (
          <div className="errand-list">
            {safeErrands.slice(0, 3).map(errand => (
              <div key={errand.id} className={`errand-card ${errand.status}`}>
                <div className="errand-info">
                  <h4>{errand.title}</h4>
                  <p>{errand.description}</p>
                  <span className="amount">${Number(errand.amount || 0).toFixed(2)}</span>
                </div>
                <div className="errand-actions">
                  <span className={`status-badge ${errand.status}`}>
                    {errand.status.replace('-', ' ').toUpperCase()}
                  </span>
                  {errand.status === 'pending' && (
                    <button 
                      onClick={() => onUpdateStatus(errand.id, 'in-progress')}
                      className="button small"
                    >
                      Start
                    </button>
                  )}
                  {errand.status === 'in-progress' && (
                    <button 
                      onClick={() => onUpdateStatus(errand.id, 'completed')}
                      className="button small success"
                    >
                      Complete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="quick-actions">
        <h3>Quick Actions</h3>
        <div className="action-buttons">
          <button onClick={handleAddErrand} className="action-button">
            <span className="action-icon">➕</span>
            <span>Add Errand</span>
          </button>
          <button onClick={handleFindErrands} className="action-button">
            <span className="action-icon">🔍</span>
            <span>Find Errands</span>
          </button>
          <button onClick={handleViewReports} className="action-button">
            <span className="action-icon">📊</span>
            <span>View Reports</span>
          </button>
          <button onClick={handleSettings} className="action-button">
            <span className="action-icon">⚙️</span>
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default Home
