import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import './Dashboard.css';
import axios from 'axios';
import { apiUrl } from '../api';
import ChatPanel from '../components/ChatPanel';
import RatingForm from '../components/RatingForm';

const RunnerDashboard = ({ user }) => {
  const [availableErrands, setAvailableErrands] = useState([]);
  const [myErrands, setMyErrands] = useState([]);
  const [verification, setVerification] = useState(null);
  const [verificationFile, setVerificationFile] = useState(null);
  const [verificationSubmitting, setVerificationSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('available'); // available, assigned
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState({ spendable: 0, withdrawable: 0, total: 0 });
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [selectedErrand, setSelectedErrand] = useState(null);
  const [progressData, setProgressData] = useState({
    status: '',
    notes: '',
    images: [],
    videos: [],
    documents: []
  });
  const [transferAmount, setTransferAmount] = useState('');

  useEffect(() => {
    fetchErrands();
    fetchBalances();
    fetchVerificationStatus();
    
    // Set up periodic balance refresh every 30 seconds
    const balanceInterval = setInterval(() => {
      fetchBalances();
    }, 30000);
    
    // Set up periodic errand refresh every 60 seconds
    const errandInterval = setInterval(() => {
      fetchErrands();
      fetchBalances(); // Also refresh balances when fetching errands
    }, 60000);
    
    return () => {
      clearInterval(balanceInterval);
      clearInterval(errandInterval);
    };
  }, []);

  const fetchVerificationStatus = async () => {
    try {
      const response = await axios.get('/api/verification/status', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setVerification(response.data?.data || null);
    } catch (error) {
      // Not fatal — the verification card just won't render until this resolves
    }
  };

  const submitVerificationDocument = async (e) => {
    e.preventDefault();
    if (!verificationFile) {
      toast.error('Choose an ID document first');
      return;
    }
    setVerificationSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('document', verificationFile);
      await axios.post('/api/verification/submit', formData, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      toast.success('Document submitted — an admin will review it soon');
      setVerificationFile(null);
      fetchVerificationStatus();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to submit document');
    } finally {
      setVerificationSubmitting(false);
    }
  };

  // Report live location for any errand that's actively assigned/in progress,
  // so the client can see this runner moving toward pickup/delivery on a
  // real map. Uses the browser's geolocation watch (not polling) so it only
  // fires on meaningful movement, then throttles how often it actually POSTs.
  useEffect(() => {
    const activeErrandIds = myErrands
      .filter(e => ['assigned', 'in_progress'].includes(e.status))
      .map(e => e.id);

    if (activeErrandIds.length === 0 || !navigator.geolocation) {
      return;
    }

    let lastSentAt = 0;
    const MIN_INTERVAL_MS = 10000;

    const reportPosition = (position) => {
      const now = Date.now();
      if (now - lastSentAt < MIN_INTERVAL_MS) return;
      lastSentAt = now;

      const { latitude, longitude } = position.coords;
      activeErrandIds.forEach((errandId) => {
        axios.post(
          `/api/errands/${errandId}/runner-location`,
          { latitude, longitude },
          { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
        ).catch(() => { /* best-effort — a missed location ping isn't worth surfacing to the runner */ });
      });
    };

    const watchId = navigator.geolocation.watchPosition(
      reportPosition,
      () => { /* location denied/unavailable — silently skip live tracking */ },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [myErrands]);

  const fetchBalances = async () => {
    try {
      const response = await axios.get('/api/wallet/balance-summary', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.data.success) {
        setBalances(response.data.balances);
      }
    } catch (error) {
      console.error('Error fetching balances:', error);
    }
  };

  const fetchErrands = async () => {
    try {
      const [availableResponse, assignedResponse] = await Promise.all([
        fetch(apiUrl('/api/errands/available'), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        }),
        fetch(apiUrl('/api/errands/runner'), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        })
      ]);

      if (availableResponse.ok) {
        const availableData = await availableResponse.json();
        setAvailableErrands(availableData.data?.errands || availableData.errands || availableData.data || []);
      }

      if (assignedResponse.ok) {
        const assignedData = await assignedResponse.json();
        setMyErrands(assignedData.data?.errands || assignedData.errands || assignedData.data || []);
      }
    } catch (error) {
      console.error('Error fetching errands:', error);
      toast.error('Error loading errands');
    } finally {
      setLoading(false);
    }
  };

  const acceptErrand = async (errandId) => {
    try {
      const response = await fetch(apiUrl(`/api/errands/${errandId}/accept`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        toast.success('Errand accepted successfully!');
        fetchErrands(); // Refresh the lists
      } else {
        const error = await response.json();
        toast.error(error.message || 'Failed to accept errand');
      }
    } catch (error) {
      console.error('Error accepting errand:', error);
      toast.error('Error accepting errand');
    }
  };

  const updateErrandStatus = async (errandId, newStatus) => {
    try {
      const response = await fetch(apiUrl(`/api/errands/${errandId}/status`), {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        toast.success(`Errand marked as ${newStatus}!`);
        fetchErrands(); // Refresh the lists
        fetchBalances(); // Refresh balances when errand is completed
        
        // Force balance refresh for completed errands
        if (newStatus === 'completed') {
          setTimeout(() => {
            fetchBalances();
          }, 2000); // Refresh again after 2 seconds to ensure backend processing is complete
        }
      } else {
        const error = await response.json();
        toast.error(error.message || 'Failed to update errand status');
      }
    } catch (error) {
      console.error('Error updating errand status:', error);
      toast.error('Error updating errand status');
    }
  };

  const openProgressModal = (errand) => {
    setSelectedErrand(errand);
    setProgressData({
      status: errand.status,
      notes: '',
      images: [],
      videos: [],
      documents: []
    });
    setShowProgressModal(true);
  };

  const handleFileUpload = (e, fileType) => {
    const files = Array.from(e.target.files);
    setProgressData(prev => ({
      ...prev,
      [fileType]: [...prev[fileType], ...files]
    }));
  };

  const removeFile = (fileType, index) => {
    setProgressData(prev => ({
      ...prev,
      [fileType]: prev[fileType].filter((_, i) => i !== index)
    }));
  };

  const submitProgress = async () => {
    if (!selectedErrand) return;

    const formData = new FormData();
    formData.append('errandId', selectedErrand.id);
    formData.append('status', progressData.status);
    formData.append('notes', progressData.notes);
    
    progressData.images.forEach(file => formData.append('images', file));
    progressData.videos.forEach(file => formData.append('videos', file));
    progressData.documents.forEach(file => formData.append('documents', file));

    try {
      const response = await axios.post('/api/errands/update-progress', formData, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        toast.success('Progress updated successfully!');
        setShowProgressModal(false);
        fetchErrands();
        fetchBalances(); // Refresh balances after progress update
        
        // Force balance refresh for completed errands
        if (progressData.status === 'completed') {
          setTimeout(() => {
            fetchBalances();
          }, 2000); // Refresh again after 2 seconds to ensure backend processing is complete
        }
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to update progress');
    }
  };

  const transferToWithdrawable = async () => {
    if (!transferAmount || parseFloat(transferAmount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      const response = await axios.post('/api/wallet/transfer', {
        amount: parseFloat(transferAmount),
        fromCurrency: 'USD',
        toCurrency: 'USD'
      }, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        toast.success('Transfer successful!');
        setTransferAmount('');
        fetchBalances();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Transfer failed');
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

  if (loading) {
    return (
      <div className="dashboard-container">
        <div className="loading">Loading errands...</div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Runner Dashboard</h1>
        <p>Welcome back, {user?.firstName || user?.name || 'Runner'}!</p>

        {verification && verification.background_check_status !== 'approved' && (
          <div style={{
            margin: '12px 0', padding: 14, borderRadius: 8,
            background: verification.background_check_status === 'rejected' ? '#fdecea' : '#fff8e1',
            border: `1px solid ${verification.background_check_status === 'rejected' ? '#f5c6cb' : '#ffe082'}`
          }}>
            {verification.background_check_status === 'pending' && !verification.has_document && (
              <>
                <strong>⚠️ Verification required</strong>
                <p style={{ margin: '6px 0', fontSize: '0.9rem' }}>
                  Submit an ID document before you can accept errands. An admin will review it.
                </p>
              </>
            )}
            {verification.background_check_status === 'pending' && verification.has_document && (
              <strong>⏳ Your document is under review. You'll be notified once it's approved.</strong>
            )}
            {verification.background_check_status === 'rejected' && (
              <>
                <strong>❌ Verification rejected</strong>
                {verification.background_check_notes && (
                  <p style={{ margin: '6px 0', fontSize: '0.9rem' }}>Reason: {verification.background_check_notes}</p>
                )}
              </>
            )}
            {(verification.background_check_status !== 'pending' || !verification.has_document) && (
              <form onSubmit={submitVerificationDocument} style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setVerificationFile(e.target.files[0])}
                />
                <button type="submit" className="btn btn-primary" disabled={verificationSubmitting}>
                  {verificationSubmitting ? 'Submitting…' : 'Submit for review'}
                </button>
              </form>
            )}
          </div>
        )}
        {verification && verification.background_check_status === 'approved' && (
          <div style={{ margin: '8px 0', fontSize: '0.85rem', color: '#2e7d32' }}>
            ✓ Identity verified — you're cleared to accept errands
          </div>
        )}

        <div className="runner-balance-section">
          <div className="balance-display">
            <div className="balance-item">
              <span className="balance-label">Available Balance:</span>
              <span className="balance-value">${Number(balances.spendable || 0).toFixed(2)}</span>
            </div>
            <div className="balance-item">
              <span className="balance-label">Withdrawable:</span>
              <span className="balance-value">${Number(balances.withdrawable || 0).toFixed(2)}</span>
            </div>
          </div>
          <div className="transfer-section">
            <input
              type="number"
              placeholder="Transfer amount"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              className="transfer-input"
            />
            <button 
              className="btn btn-success transfer-btn"
              onClick={transferToWithdrawable}
              disabled={!transferAmount || parseFloat(transferAmount) <= 0}
            >
              Transfer to Withdrawable
            </button>
          </div>
        </div>
      </div>

      <div className="dashboard-stats">
        <div className="stat-card">
          <h3>{availableErrands.length}</h3>
          <p>Available Errands</p>
        </div>
        <div className="stat-card">
          <h3>{myErrands.filter(e => e.status === 'assigned').length}</h3>
          <p>Assigned to Me</p>
        </div>
        <div className="stat-card">
          <h3>{myErrands.filter(e => e.status === 'in_progress').length}</h3>
          <p>In Progress</p>
        </div>
        <div className="stat-card">
          <h3>{myErrands.filter(e => e.status === 'completed').length}</h3>
          <p>Completed</p>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="tab-navigation">
          <button 
            className={activeTab === 'available' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('available')}
          >
            Available Errands ({availableErrands.length})
          </button>
          <button 
            className={activeTab === 'assigned' ? 'tab-button active' : 'tab-button'}
            onClick={() => setActiveTab('assigned')}
          >
            My Errands ({myErrands.length})
          </button>
        </div>

        {activeTab === 'available' && (
          <div className="tab-content">
            <h2>Available Errands</h2>
            {availableErrands.length === 0 ? (
              <div className="no-errands">
                <p>No available errands at the moment. Check back later!</p>
              </div>
            ) : (
              <div className="errands-grid">
                {availableErrands.map(errand => (
                  <div key={errand.id} className="errand-card available">
                    <div className="errand-header">
                      <h3>{errand.title}</h3>
                      <span className="price-badge">${errand.price}</span>
                    </div>
                    <p className="errand-description">{errand.description}</p>
                    <div className="errand-details">
                      <p><strong>Client:</strong> {errand.clientName}</p>
                      <p><strong>Location:</strong> {errand.location}</p>
                      <p><strong>Posted:</strong> {new Date(errand.createdAt).toLocaleDateString()}</p>
                      {errand.deadline && (
                        <p><strong>Deadline:</strong> {new Date(errand.deadline).toLocaleDateString()}</p>
                      )}
                    </div>
                    <div className="errand-actions">
                      <button 
                        className="btn btn-primary"
                        onClick={() => acceptErrand(errand.id)}
                        disabled={verification && verification.background_check_status !== 'approved'}
                        title={verification && verification.background_check_status !== 'approved' ? 'Your ID must be verified before you can accept errands' : ''}
                      >
                        Accept Errand
                      </button>
                      <button className="btn btn-outline">
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'assigned' && (
          <div className="tab-content">
            <h2>My Errands</h2>
            {myErrands.length === 0 ? (
              <div className="no-errands">
                <p>No assigned errands yet. Browse available errands to get started!</p>
              </div>
            ) : (
              <div className="errands-grid">
                {myErrands.map(errand => (
                  <div key={errand.id} className="errand-card assigned">
                    <div className="errand-header">
                      <h3>{errand.title}</h3>
                      <span 
                        className="status-badge"
                        style={{ backgroundColor: getStatusColor(errand.status) }}
                      >
                        {errand.status}
                      </span>
                    </div>
                    <p className="errand-description">{errand.description}</p>
                    <div className="errand-details">
                      <p><strong>Client:</strong> {errand.clientName}</p>
                      <p><strong>Price:</strong> ${errand.price}</p>
                      <p><strong>Location:</strong> {errand.location}</p>
                      {errand.clientPhone && (
                        <p><strong>Client Phone:</strong> {errand.clientPhone}</p>
                      )}
                      <p><strong>Accepted:</strong> {new Date(errand.acceptedAt).toLocaleDateString()}</p>
                    </div>

                    {['assigned', 'in_progress'].includes(errand.status) && (
                      <ChatPanel errandId={errand.id} currentUserId={user?.id} />
                    )}
                    {errand.status === 'completed' && (
                      <RatingForm errandId={errand.id} revieweeLabel="the client" />
                    )}

                    <div className="errand-actions">
                      {errand.status === 'assigned' && (
                        <button 
                          className="btn btn-primary"
                          onClick={() => updateErrandStatus(errand.id, 'in_progress')}
                        >
                          Start Errand
                        </button>
                      )}
                      {errand.status === 'in_progress' && (
                        <>
                          <button 
                            className="btn btn-info"
                            onClick={() => openProgressModal(errand)}
                          >
                            Update Progress
                          </button>
                          <button 
                            className="btn btn-success"
                            onClick={() => updateErrandStatus(errand.id, 'completed')}
                          >
                            Mark Complete
                          </button>
                        </>
                      )}
                      <button className="btn btn-outline">
                        View Details
                      </button>
                      {errand.status !== 'completed' && (
                        <button 
                          className="btn btn-danger"
                          onClick={() => updateErrandStatus(errand.id, 'cancelled')}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {/* Progress Update Modal */}
        {showProgressModal && selectedErrand && (
          <div className="modal-overlay" onClick={() => setShowProgressModal(false)}>
            <div className="modal-content progress-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Update Progress - {selectedErrand.title}</h3>
                <button className="close-btn" onClick={() => setShowProgressModal(false)}>×</button>
              </div>
              
              <div className="progress-form">
                <div className="form-group">
                  <label>Status Update</label>
                  <select
                    value={progressData.status}
                    onChange={(e) => setProgressData({...progressData, status: e.target.value})}
                    className="status-select"
                  >
                    <option value="assigned">Assigned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Progress Notes</label>
                  <textarea
                    value={progressData.notes}
                    onChange={(e) => setProgressData({...progressData, notes: e.target.value})}
                    placeholder="Add notes about your progress..."
                    rows={4}
                  />
                </div>
                
                <div className="file-upload-section">
                  <div className="upload-group">
                    <label>📸 Upload Images</label>
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      onChange={(e) => handleFileUpload(e, 'images')}
                    />
                    <div className="file-preview">
                      {progressData.images.map((file, index) => (
                        <div key={index} className="file-item">
                          <span>{file.name}</span>
                          <button type="button" onClick={() => removeFile('images', index)}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="upload-group">
                    <label>🎥 Upload Videos</label>
                    <input
                      type="file"
                      multiple
                      accept="video/*"
                      onChange={(e) => handleFileUpload(e, 'videos')}
                    />
                    <div className="file-preview">
                      {progressData.videos.map((file, index) => (
                        <div key={index} className="file-item">
                          <span>{file.name}</span>
                          <button type="button" onClick={() => removeFile('videos', index)}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="upload-group">
                    <label>📄 Upload Documents</label>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.txt"
                      onChange={(e) => handleFileUpload(e, 'documents')}
                    />
                    <div className="file-preview">
                      {progressData.documents.map((file, index) => (
                        <div key={index} className="file-item">
                          <span>{file.name}</span>
                          <button type="button" onClick={() => removeFile('documents', index)}>×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="modal-actions">
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    onClick={() => setShowProgressModal(false)}
                  >
                    Cancel
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    onClick={submitProgress}
                  >
                    Update Progress
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RunnerDashboard;
