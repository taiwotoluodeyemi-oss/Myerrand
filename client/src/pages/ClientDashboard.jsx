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
  const emptyErrand = {
    title: '',
    description: '',
    pickup_address: '',
    delivery_address: '',
    pickup_lat: '',
    pickup_lng: '',
    delivery_lat: '',
    delivery_lng: '',
    mode: 'motorcycle',
    category: 'delivery',
    urgency: 'medium'
  };
  const [newErrand, setNewErrand] = useState(emptyErrand);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);

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

  // Live quote whenever pickup/delivery/mode/urgency change
  useEffect(() => {
    if (!showCreateModal) return;
    const hasCoords =
      newErrand.pickup_lat && newErrand.pickup_lng &&
      newErrand.delivery_lat && newErrand.delivery_lng;
    const hasAddresses = newErrand.pickup_address && newErrand.delivery_address;
    if (!hasCoords && !hasAddresses) {
      setQuote(null);
      return;
    }

    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const params = new URLSearchParams();
        if (newErrand.pickup_lat) params.set('pickup_lat', newErrand.pickup_lat);
        if (newErrand.pickup_lng) params.set('pickup_lng', newErrand.pickup_lng);
        if (newErrand.delivery_lat) params.set('delivery_lat', newErrand.delivery_lat);
        if (newErrand.delivery_lng) params.set('delivery_lng', newErrand.delivery_lng);
        if (newErrand.pickup_address) params.set('pickup_address', newErrand.pickup_address);
        if (newErrand.delivery_address) params.set('delivery_address', newErrand.delivery_address);
        params.set('mode', newErrand.mode || 'motorcycle');
        params.set('urgency', newErrand.urgency || 'medium');

        const response = await axios.get(`/api/errands/quote?${params.toString()}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        if (response.data.success) {
          setQuote(response.data.data);
        } else {
          setQuote(null);
          setQuoteError(response.data.error || 'Could not get quote');
        }
      } catch (err) {
        setQuote(null);
        setQuoteError(err.response?.data?.error || 'Could not get quote');
      } finally {
        setQuoteLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [
    showCreateModal,
    newErrand.pickup_lat, newErrand.pickup_lng,
    newErrand.delivery_lat, newErrand.delivery_lng,
    newErrand.pickup_address, newErrand.delivery_address,
    newErrand.mode, newErrand.urgency
  ]);

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
        setErrands(data.data?.errands || data.errands || []);
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
    if (!newErrand.title || !newErrand.pickup_address || !newErrand.delivery_address) {
      toast.error('Please fill in title, pickup and delivery addresses');
      return;
    }
    if (!quote) {
      toast.error('Wait for a price quote before creating the errand');
      return;
    }

    try {
      const payload = {
        ...newErrand,
        // Server recomputes price; do not send a client amount
      };
      delete payload.amount;

      const response = await axios.post('/api/errands/create', payload, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        toast.success(`Errand created — total ₦${quote.client_total?.toLocaleString()}`);
        setShowCreateModal(false);
        setNewErrand({ ...emptyErrand });
        setQuote(null);
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
                    <label>Pickup lat / lng (optional)</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="number" step="any" value={newErrand.pickup_lat}
                        onChange={(e) => setNewErrand({...newErrand, pickup_lat: e.target.value})} placeholder="lat" />
                      <input type="number" step="any" value={newErrand.pickup_lng}
                        onChange={(e) => setNewErrand({...newErrand, pickup_lng: e.target.value})} placeholder="lng" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Delivery lat / lng (optional)</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="number" step="any" value={newErrand.delivery_lat}
                        onChange={(e) => setNewErrand({...newErrand, delivery_lat: e.target.value})} placeholder="lat" />
                      <input type="number" step="any" value={newErrand.delivery_lng}
                        onChange={(e) => setNewErrand({...newErrand, delivery_lng: e.target.value})} placeholder="lng" />
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Transport mode *</label>
                    <select value={newErrand.mode}
                      onChange={(e) => setNewErrand({...newErrand, mode: e.target.value})}>
                      <option value="foot">Foot</option>
                      <option value="bicycle">Bicycle</option>
                      <option value="motorcycle">Motorcycle</option>
                      <option value="car">Car</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Category</label>
                    <select value={newErrand.category}
                      onChange={(e) => setNewErrand({...newErrand, category: e.target.value})}>
                      <option value="delivery">Delivery</option>
                      <option value="shopping">Shopping</option>
                      <option value="pickup">Pickup</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Urgency</label>
                    <select value={newErrand.urgency}
                      onChange={(e) => setNewErrand({...newErrand, urgency: e.target.value})}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>

                <div className="quote-breakdown" style={{
                  margin: '12px 0', padding: 12, borderRadius: 8,
                  background: '#f8fafc', border: '1px solid #e2e8f0'
                }}>
                  <h4 style={{ marginTop: 0 }}>Price quote</h4>
                  {quoteLoading && <p>Calculating…</p>}
                  {quoteError && !quoteLoading && (
                    <p style={{ color: '#b91c1c' }}>{quoteError}</p>
                  )}
                  {quote && !quoteLoading && (
                    <table style={{ width: '100%', fontSize: 14 }}>
                      <tbody>
                        <tr><td>Distance</td><td style={{ textAlign: 'right' }}>{quote.distance_km} km</td></tr>
                        <tr><td>Base fare</td><td style={{ textAlign: 'right' }}>₦{Number(quote.base_fare).toLocaleString()}</td></tr>
                        <tr><td>Distance cost</td><td style={{ textAlign: 'right' }}>₦{Number(quote.distance_cost).toLocaleString()}</td></tr>
                        <tr><td>Fuel</td><td style={{ textAlign: 'right' }}>₦{Number(quote.fuel_cost).toLocaleString()}</td></tr>
                        {quote.urgency_fee > 0 && (
                          <tr><td>Urgency</td><td style={{ textAlign: 'right' }}>₦{Number(quote.urgency_fee).toLocaleString()}</td></tr>
                        )}
                        <tr><td>Subtotal</td><td style={{ textAlign: 'right' }}>₦{Number(quote.subtotal).toLocaleString()}</td></tr>
                        <tr><td>Platform fee</td><td style={{ textAlign: 'right' }}>₦{Number(quote.platform_fee).toLocaleString()}</td></tr>
                        <tr>
                          <td>VAT ({((quote.vat_rate || 0.075) * 100).toFixed(1)}%)</td>
                          <td style={{ textAlign: 'right' }}>₦{Number(quote.vat).toLocaleString()}</td>
                        </tr>
                        <tr style={{ fontWeight: 700, borderTop: '1px solid #cbd5e1' }}>
                          <td>Total</td>
                          <td style={{ textAlign: 'right' }}>₦{Number(quote.client_total).toLocaleString()}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                  {!quote && !quoteLoading && !quoteError && (
                    <p style={{ color: '#64748b' }}>Enter addresses or coordinates to see the price.</p>
                  )}
                </div>

                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => { setShowCreateModal(false); setQuote(null); }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!quote || quoteLoading}>
                    {quote ? `Create ₦${Number(quote.client_total).toLocaleString()}` : 'Create Errand'}
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
