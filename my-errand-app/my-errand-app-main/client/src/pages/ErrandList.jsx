import React, { useState } from 'react'

function ErrandList({ errands, onAddErrand, onUpdateStatus }) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [filter, setFilter] = useState('all')
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    amount: ''
  })

  const filteredErrands = errands.filter(errand => {
    if (filter === 'all') return true
    return errand.status === filter
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    if (formData.title && formData.description && formData.amount) {
      onAddErrand({
        title: formData.title,
        description: formData.description,
        amount: parseFloat(formData.amount)
      })
      setFormData({ title: '', description: '', amount: '' })
      setShowAddForm(false)
    }
  }

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  return (
    <div className="errand-list-page">
      <div className="page-actions">
        <div className="filter-buttons">
          <button 
            className={filter === 'all' ? 'active' : ''} 
            onClick={() => setFilter('all')}
          >
            All ({errands.length})
          </button>
          <button 
            className={filter === 'pending' ? 'active' : ''} 
            onClick={() => setFilter('pending')}
          >
            Pending ({errands.filter(e => e.status === 'pending').length})
          </button>
          <button 
            className={filter === 'in-progress' ? 'active' : ''} 
            onClick={() => setFilter('in-progress')}
          >
            In Progress ({errands.filter(e => e.status === 'in-progress').length})
          </button>
          <button 
            className={filter === 'completed' ? 'active' : ''} 
            onClick={() => setFilter('completed')}
          >
            Completed ({errands.filter(e => e.status === 'completed').length})
          </button>
        </div>
        
        <button 
          className="button primary"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? 'Cancel' : '+ Add New Errand'}
        </button>
      </div>

      {showAddForm && (
        <div className="add-errand-form">
          <h3>Add New Errand</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="title">Title</label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                placeholder="Enter errand title"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Enter errand description"
                rows="3"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="amount">Amount ($)</label>
              <input
                type="number"
                id="amount"
                name="amount"
                value={formData.amount}
                onChange={handleInputChange}
                placeholder="0.00"
                min="0"
                step="0.01"
                required
              />
            </div>
            
            <div className="form-actions">
              <button type="submit" className="button success">
                Add Errand
              </button>
              <button 
                type="button" 
                className="button secondary"
                onClick={() => setShowAddForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="errands-grid">
        {filteredErrands.length === 0 ? (
          <div className="no-errands">
            <p>No errands found for the selected filter.</p>
            {filter !== 'all' && (
              <button 
                className="button" 
                onClick={() => setFilter('all')}
              >
                Show All Errands
              </button>
            )}
          </div>
        ) : (
          filteredErrands.map(errand => (
            <div key={errand.id} className={`errand-card detailed ${errand.status}`}>
              <div className="errand-header">
                <h4>{errand.title}</h4>
                <span className="amount">${Number(errand.amount || 0).toFixed(2)}</span>
              </div>
              
              <div className="errand-body">
                <p>{errand.description}</p>
              </div>
              
              <div className="errand-footer">
                <span className={`status-badge ${errand.status}`}>
                  {errand.status.replace('-', ' ').toUpperCase()}
                </span>
                
                <div className="errand-actions">
                  {errand.status === 'pending' && (
                    <button 
                      onClick={() => onUpdateStatus(errand.id, 'in-progress')}
                      className="button small"
                    >
                      Start Task
                    </button>
                  )}
                  {errand.status === 'in-progress' && (
                    <button 
                      onClick={() => onUpdateStatus(errand.id, 'completed')}
                      className="button small success"
                    >
                      Mark Complete
                    </button>
                  )}
                  {errand.status === 'completed' && (
                    <span className="completed-icon">✅ Done</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default ErrandList
