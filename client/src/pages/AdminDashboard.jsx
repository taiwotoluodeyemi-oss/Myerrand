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
  const [giftOrders, setGiftOrders] = useState([])
  const [giftStats, setGiftStats] = useState(null)
  const [fulfillCode, setFulfillCode] = useState({})
  const [fulfillNotes, setFulfillNotes] = useState({})
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
      try {
        const go = await axios.get('/api/admin/gift-card-orders?status=pending_fulfillment', { headers: headers() })
        setGiftOrders(go.data.orders || [])
        const gs = await axios.get('/api/admin/gift-card-stats', { headers: headers() })
        setGiftStats(gs.data)
      } catch (_) {
        setGiftOrders([])
      }
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

  const fulfillOrder = async (id) => {
    try {
      await axios.post(
        `/api/admin/gift-card-orders/${id}/fulfill`,
        { code: fulfillCode[id], notes: fulfillNotes[id] || '' },
        { headers: headers() }
      )
      setFulfillCode((m) => ({ ...m, [id]: '' }))
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Fulfillment failed')
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
        <h3>Gift card commerce</h3>
        {giftStats && (
          <p>
            Sales ₦{Number(giftStats.total_sales_ngn || 0).toLocaleString()} ·
            Pending {giftStats.pending_fulfillment} ·
            Fulfilled {giftStats.fulfilled}
          </p>
        )}
        {giftOrders.length === 0 ? (
          <p style={{ color: '#6c757d' }}>No gift-card orders awaiting fulfillment</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ref</th><th>Customer</th><th>Product</th><th>Price</th><th>Code</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {giftOrders.map((o) => (
                <tr key={o.id}>
                  <td>{o.order_ref}</td>
                  <td>{o.customer_name}<br/><small>{o.customer_email}</small></td>
                  <td>{o.product_name} ({o.region})</td>
                  <td>₦{Number(o.price_ngn).toLocaleString()}</td>
                  <td>
                    <input
                      type="text"
                      placeholder="Gift card code"
                      value={fulfillCode[o.id] || ''}
                      onChange={(e) => setFulfillCode((m) => ({ ...m, [o.id]: e.target.value }))}
                    />
                    <input
                      type="text"
                      placeholder="Notes"
                      value={fulfillNotes[o.id] || ''}
                      onChange={(e) => setFulfillNotes((m) => ({ ...m, [o.id]: e.target.value }))}
                    />
                  </td>
                  <td><button type="button" onClick={() => fulfillOrder(o.id)}>Fulfill</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

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
