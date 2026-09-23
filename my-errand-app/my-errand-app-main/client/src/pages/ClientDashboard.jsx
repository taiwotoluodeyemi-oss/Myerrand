import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import './Dashboard.css';
import axios from 'axios';
import { apiUrl } from '../api';
import ErrandTrackingMap from '../components/ErrandTrackingMap';

const ClientDashboard = ({ user, balances }) => {
  const [errands, setErrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, pending, in_progress, completed
  // Removed local balances state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newErrand, setNewErrand] = useState({
    title: '',
    description: '',
    pickup_address: '',
    delivery_address: '',
    amount: '',
    category: 'delivery',
    urgency: 'medium'
  });

  // New state for errand details modal
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedErrand, setSelectedErrand] = useState(null);

  useEffect(() => {
    fetchClientErrands();
    // Removed fetchBalances call
    
    // Setup periodic refresh every 1 minute to keep data current
    const interval = setInterval(() => {
      fetchClientErrands();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const fetchBalances = async () => {
    try {
      const response = await axios.get('/api/wallet/balance-summary', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.data.success) {
        // Removed setBalances call
      }
    } catch (error) {
      console.error('Error fetching balances:', error);
    }
  };

  const fetchClientErrands = async () => {
    try {
      const response = await fetch(apiUrl('/api/errands/client'), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setErrands(data.errands || []);
        // Refresh balances when errands are updated to reflect any status changes
        fetchBalances();
      } else {
        toast.error('Failed to fetch errands');
      }
    } catch (error) {
      console.error('Error fetching errands:', error);
      toast.error('Error loading errands');
    } finally {
      setLoading(false);
    }
  };

  const createNewErrand = () => {
    setShowCreateModal(true);
  };

  const handleCreateErrand = async (e) => {
    e.preventDefault();
    if (!newErrand.title || !newErrand.description || !newErrand.amount) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const response = await axios.post('/api/errands/create', newErrand, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        toast.success('Errand created successfully!');
        setShowCreateModal(false);
        setNewErrand({
          title: '',
          description: '',
          pickup_address: '',
          delivery_address: '',
          amount: '',
          category: 'delivery',
          urgency: 'medium'
        });
        fetchClientErrands();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to create errand');
    }
  };

  const payForErrand = async (errandId, amount) => {
    try {
      const response = await axios.post(`/api/errands/pay/${errandId}`, {}, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        toast.success('Payment moved to escrow successfully!');
        fetchClientErrands();
        fetchBalances();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Payment failed');
    }
  };

  const cancelErrand = async (errandId) => {
    if (!window.confirm('Are you sure you want to cancel this errand?')) return;

    try {
      const response = await axios.patch(`/api/errands/cancel/${errandId}`, {}, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        toast.success('Errand cancelled successfully!');
        fetchClientErrands();
        fetchBalances();
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to cancel errand');
    }
  };

  const viewErrandDetails = (errandId) => {
    const errand = errands.find(e => e.id === errandId);
    if (errand) {
      setSelectedErrand(errand);
      setShowDetailsModal(true);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return '#ffa500';
      case 'assigned': return '#2196f3';
      case 'in_progress': return '#ff9800';
      case 'completed': return '#4caf50';
      case 'cancelled': return '#f44336';
      default: return '#757575';
    }
  };

  const getProgressPercentage = (status) => {
    switch (status) {
      case 'pending': return 10;
      case 'assigned': return 25;
      case 'in_progress': return 65;
      case 'completed': return 100;
      case 'cancelled': return 0;
      default: return 0;
    }
  };

  const formatAddress = (address) => {
    if (!address) return 'N/A';
    return address.length > 30 ? address.substring(0, 30) + '...' : address;
  };

  const filteredErrands = errands.filter(errand => {
    if (filter === 'all') return true;
    return errand.status === filter;
  });

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading">Loading your errands...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Client Dashboard</h1>
        <p>Welcome back, {user?.firstName || user?.name || 'Client'}!</p>
        <div className="header-actions">
          <div className="balance-display">
            <div className="balance-item">
              <span className="balance-label">Spendable:</span>
              <span className="balance-value">${Number(balances.spendable || 0).toFixed(2)}</span>
            </div>
            <div className="balance-item">
              <span className="balance-label">In Escrow:</span>
              <span className="balance-value">${Number(balances.escrow || 0).toFixed(2)}</span>
            </div>
            <div className="balance-item">
              <span className="balance-label">Withdrawable:</span>
              <span className="balance-value">${Number(balances.withdrawable || 0).toFixed(2)}</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={createNewErrand}>
            + Create New Errand
          </button>
        </div>
      </div>

      <div className="dashboard-stats">
        <div className="stat-card">
          <h3>{errands.length}</h3>
          <p>Total Errands</p>
        </div>
        <div className="stat-card">
          <h3>{errands.filter(e => e.status === 'pending').length}</h3>
          <p>Pending</p>
        </div>
        <div className="stat-card">
          <h3>{errands.filter(e => e.status === 'in_progress').length}</h3>
          <p>In Progress</p>
        </div>
        <div className="stat-card">
          <h3>{errands.filter(e => e.status === 'completed').length}</h3>
          <p>Completed</p>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="section-header">
          <h2>Your Errands</h2>
          <div className="filter-buttons">
            <button 
              className={filter === 'all' ? 'active' : ''}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button 
              className={filter === 'pending' ? 'active' : ''}
              onClick={() => setFilter('pending')}
            >
              Pending
            </button>
            <button 
              className={filter === 'in_progress' ? 'active' : ''}
              onClick={() => setFilter('in_progress')}
            >
              In Progress
            </button>
            <button 
              className={filter === 'completed' ? 'active' : ''}
              onClick={() => setFilter('completed')}
            >
              Completed
            </button>
          </div>
        </div>

        {filteredErrands.length === 0 ? (
          <div className="no-errands">
            <p>No errands found. {filter === 'all' ? 'Create your first errand!' : `No ${filter} errands.`}</p>
          </div>
        ) : (
          <div className="errands-grid">
            {filteredErrands.map(errand => (
              <div key={errand.id} className="errand-card">
                <div className="errand-header">
                  <h3>{errand.title}</h3>
                  <span 
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(errand.status) }}
                  >
                    {errand.status}
                  </span>
                </div>
                
                {/* Progress Bar */}
                <div className="progress-container">
                  <div className="progress-bar">
                    <div 
                      className="progress-fill"
                      style={{ 
                        width: `${getProgressPercentage(errand.status)}%`,
                        backgroundColor: getStatusColor(errand.status)
                      }}
                    ></div>
                  </div>
                  <span className="progress-text">{getProgressPercentage(errand.status)}% Complete</span>
                </div>

                <p className="errand-description">{errand.description}</p>
                
                {/* Map: real tracking map once there's an assigned runner, otherwise a lightweight placeholder */}
                {['assigned', 'in_progress'].includes(errand.status) ? (
                  <ErrandTrackingMap
                    errandId={errand.id}
                    status={errand.status}
                    pickupAddress={errand.pickup_address}
                    deliveryAddress={errand.delivery_address}
                  />
                ) : (
                  <div className="mini-map">
                    <div className="map-placeholder">
                      🗺️ Map View
                      <div className="map-details">
                        <div><strong>From:</strong> {formatAddress(errand.pickup_address)}</div>
                        <div><strong>To:</strong> {formatAddress(errand.delivery_address)}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Chat with the runner while there's an active engagement */}
                {['assigned', 'in_progress'].includes(errand.status) && errand.runner_id && (
                  <ChatPanel errandId={errand.id} currentUserId={user?.id} />
                )}

                {/* Rate the runner once the errand is done */}
                {errand.status === 'completed' && errand.runner_id && (
                  <RatingForm errandId={errand.id} revieweeLabel="your runner" />
                )}
                
                <div className="errand-details">
                  <p><strong>Price:</strong> ${errand.amount || errand.price}</p>
                  <p><strong>Category:</strong> {errand.category}</p>
                  <p><strong>Created:</strong> {new Date(errand.created_at || errand.createdAt).toLocaleDateString()}</p>
                  {errand.runner_name && (
                    <p><strong>Runner:</strong> {errand.runner_name}</p>
                  )}
                  {errand.urgency && (
                    <p><strong>Urgency:</strong> <span className={`urgency-${errand.urgency}`}>{errand.urgency}</span></p>
                  )}
                </div>
                
                <div className="errand-actions">
                  <button 
                    className="btn btn-outline"
                    onClick={() => viewErrandDetails(errand.id)}
                  >
                    View Details
                  </button>
                  
                  {errand.status === 'pending' && !errand.payment_status && (
                    <button 
                      className="btn btn-success"
                      onClick={() => payForErrand(errand.id, errand.amount)}
                    >
                      Pay & Start
                    </button>
                  )}
                  
                  {(errand.status === 'pending' || errand.status === 'assigned') && (
                    <button 
                      className="btn btn-danger"
                      onClick={() => cancelErrand(errand.id)}
                    >
                      Cancel
                    </button>
                  )}
                  
                  {errand.status === 'in_progress' && (
                    <button 
                      className="btn btn-warning"
                      onClick={() => cancelErrand(errand.id)}
                    >
                      Stop Errand
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Create Errand Modal */}
        {showCreateModal && (
          <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Create New Errand</h3>
                <button className="close-btn" onClick={() => setShowCreateModal(false)}>×</button>
              </div>
              
              <form onSubmit={handleCreateErrand} className="create-errand-form">
                <div className="form-group">
                  <label>Title *</label>
                  <input
                    type="text"
                    value={newErrand.title}
                    onChange={(e) => setNewErrand({...newErrand, title: e.target.value})}
                    placeholder="Enter errand title"
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Description *</label>
                  <textarea
                    value={newErrand.description}
                    onChange={(e) => setNewErrand({...newErrand, description: e.target.value})}
                    placeholder="Describe what needs to be done"
                    required
                  />
                </div>
                
                <div className="form-row">
                  <div className="form-group">
                    <label>Pickup Address</label>
                    <input
                      type="text"
                      value={newErrand.pickup_address}
                      onChange={(e) => setNewErrand({...newErrand, pickup_address: e.target.value})}
                      placeholder="Where to pick up from"
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Delivery Address</label>
                    <input
                      type="text"
                      value={newErrand.delivery_address}
                      onChange={(e) => setNewErrand({...newErrand, delivery_address: e.target.value})}
                      placeholder="Where to deliver to"
                    />
                  </div>
                </div>
                
                <div className="form-row">
                  <div className="form-group">
                    <label>Amount ($) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newErrand.amount}
                      onChange={(e) => setNewErrand({...newErrand, amount: e.target.value})}
                      placeholder="0.00"
                      required
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Category</label>
                    <select
                      value={newErrand.category}
                      onChange={(e) => setNewErrand({...newErrand, category: e.target.value})}
                    >
                      <option value="delivery">Delivery</option>
                      <option value="shopping">Shopping</option>
                      <option value="pickup">Pickup</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  
                  <div className="form-group">
                    <label>Urgency</label>
                    <select
                      value={newErrand.urgency}
                      onChange={(e) => setNewErrand({...newErrand, urgency: e.target.value})}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>
                
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Create Errand
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientDashboard;
