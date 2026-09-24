import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { apiUrl } from '../api'
import './Dashboard.css'

export default function GiftCardOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [codeMap, setCodeMap] = useState({})

  const token = () => localStorage.getItem('token')

  const load = async () => {
    try {
      const res = await fetch(apiUrl('/api/gift-cards/orders'), {
        headers: { Authorization: `Bearer ${token()}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setOrders(data.orders || [])
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const reveal = async (id) => {
    try {
      const res = await fetch(apiUrl(`/api/gift-cards/orders/${id}/code`), {
        headers: { Authorization: `Bearer ${token()}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Cannot reveal')
      setCodeMap((m) => ({ ...m, [id]: data.code }))
    } catch (e) {
      toast.error(e.message)
    }
  }

  const cancel = async (id) => {
    if (!window.confirm('Cancel order and refund wallet?')) return
    try {
      const res = await fetch(apiUrl(`/api/gift-cards/orders/${id}/cancel`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Cancel failed')
      toast.success(`Refunded ₦${data.refunded}`)
      load()
    } catch (e) {
      toast.error(e.message)
    }
  }

  if (loading) return <div className="dashboard-page"><p>Loading orders…</p></div>

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h2>My Gift Card Orders</h2>
        <Link to="/gift-cards">Browse gift cards</Link>
      </div>
      {orders.length === 0 && <p>No orders yet.</p>}
      <div className="errands-grid">
        {orders.map((o) => (
          <div key={o.id} className="errand-card">
            <h3>{o.order_ref}</h3>
            <p>{o.product_name} ({o.region})</p>
            <p>₦{Number(o.price_ngn).toLocaleString()} · {o.status}</p>
            <p style={{ fontSize: '0.85rem' }}>{new Date(o.created_at).toLocaleString()}</p>
            {o.status === 'fulfilled' && (
              codeMap[o.id] ? (
                <p><strong>Code:</strong> <code>{codeMap[o.id]}</code>
                  <button type="button" className="btn" style={{ marginLeft: 8 }}
                    onClick={() => { navigator.clipboard.writeText(codeMap[o.id]); toast.success('Copied') }}>
                    Copy
                  </button>
                </p>
              ) : (
                <button className="btn btn-primary" onClick={() => reveal(o.id)}>Reveal code</button>
              )
            )}
            {(o.status === 'pending_fulfillment' || o.status === 'under_review') && (
              <button className="btn" onClick={() => cancel(o.id)}>Cancel & refund</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
