import React, { useEffect, useState } from 'react'
import axios from 'axios'
import './Dashboard.css'

export default function AdminDashboard({ user }) {
  const [users, setUsers] = useState([])
  const [errands, setErrands] = useState([])
  const [payments, setPayments] = useState([])
  const [pendingRunners, setPendingRunners] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [decisionNotes, setDecisionNotes] = useState({})
  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [u, e, p, v] = await Promise.all([
        axios.get('/api/admin/users', { headers: headers() }),
        axios.get('/api/admin/errands', { headers: headers() }),
        axios.get('/api/admin/payments', { headers: headers() }),
        axios.get('/api/verification/admin/pending', { headers: headers() }),
      ])
      setUsers(u.data.users || [])
      setErrands(e.data.errands || [])
      setPayments(p.data.payments || [])
      setPendingRunners(v.data?.data?.runners || [])
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const setStatus = async (id, status) => {
    try {
      await axios.patch(`/api/admin/users/${id}/status`, { status }, { headers: headers() })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Status update failed')
    }
  }

  const viewDocument = async (runnerUserId) => {
    try {
      const response = await axios.get(`/api/verification/admin/document/${runnerUserId}`, {
        headers: headers(),
        responseType: 'blob'
      })
      const url = URL.createObjectURL(response.data)
      window.open(url, '_blank')
    } catch (err) {
      setError('Could not load document')
    }
  }

  const decide = async (runnerUserId, decision) => {
    try {
      await axios.post(
        `/api/verification/admin/${runnerUserId}/decision`,
        { decision, notes: decisionNotes[runnerUserId] || '' },
        { headers: headers() }
      )
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Decision failed')
    }
  }

  if (loading) return <div className="dashboard"><p>Loading admin…</p></div>

  return (
    <div className="dashboard">
      <h2>Admin</h2>
      <p>Signed in as {user?.email}</p>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button type="button" onClick={load}>Refresh</button>

      <section>
        <h3>Runner verification queue ({pendingRunners.length})</h3>
        {pendingRunners.length === 0 ? (
          <p style={{ color: '#6c757d' }}>No runners waiting on review</p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Document</th><th>Notes</th><th>Decision</th></tr>
            </thead>
            <tbody>
              {pendingRunners.map((r) => (
                <tr key={r.user_id}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td><button type="button" onClick={() => viewDocument(r.user_id)}>View document</button></td>
                  <td>
                    <input
                      type="text"
                      placeholder="Reason (for rejection)"
                      value={decisionNotes[r.user_id] || ''}
                      onChange={(e) => setDecisionNotes({ ...decisionNotes, [r.user_id]: e.target.value })}
                      style={{ width: 160 }}
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => decide(r.user_id, 'approved')}>Approve</button>
                    <button type="button" onClick={() => decide(r.user_id, 'rejected')}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3>Users ({users.length})</h3>
        <table>
          <thead>
            <tr><th>ID</th><th>Name</th><th>Email</th><th>Type</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.user_type}</td>
                <td>{u.status}</td>
                <td>
                  <button type="button" onClick={() => setStatus(u.id, 'active')}>Active</button>
                  <button type="button" onClick={() => setStatus(u.id, 'suspended')}>Suspend</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Errands ({errands.length})</h3>
        <ul>
          {errands.slice(0, 50).map((e) => (
            <li key={e.id}>
              #{e.id} {e.title} — {e.status} / {e.payment_status || 'n/a'} —
              {e.client_name} → {e.runner_name || 'unassigned'} —
              ${Number(e.amount || e.budget_amount || 0).toFixed(2)}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Recent transactions ({payments.length})</h3>
        <ul>
          {payments.slice(0, 30).map((t) => (
            <li key={t.id}>
              #{t.id} {t.transaction_type} {t.amount} {t.currency} — {t.status} — {t.user_email || ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
