import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { apiUrl } from '../api'
import './Dashboard.css'

export default function GiftCards({ user }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [buyingId, setBuyingId] = useState(null)
  const [balance, setBalance] = useState(null)

  const token = () => localStorage.getItem('token')

  useEffect(() => {
    const load = async () => {
      try {
        const [pRes, bRes] = await Promise.all([
          fetch(apiUrl('/api/gift-cards/products')),
          user ? fetch(apiUrl('/api/wallet/balance-summary?currency=NGN'), {
            headers: { Authorization: `Bearer ${token()}` }
          }) : Promise.resolve(null)
        ])
        const pData = await pRes.json()
        setProducts(pData.products || [])
        if (bRes && bRes.ok) {
          const b = await bRes.json()
          setBalance(b.balances?.spendable ?? b.balances?.total ?? null)
        }
      } catch (e) {
        toast.error('Failed to load gift cards')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user])

  const buy = async (product) => {
    if (!user) {
      toast.info('Please log in to purchase')
      return
    }
    if (!window.confirm(`Buy ${product.product_name} for ₦${Number(product.selling_price_ngn).toLocaleString()}?`)) return
    setBuyingId(product.id)
    try {
      const res = await fetch(apiUrl(`/api/gift-cards/products/${product.id}/purchase`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.shortfall != null) {
          toast.error(`Insufficient funds. Need ₦${data.shortfall} more.`)
        } else {
          toast.error(data.error || 'Purchase failed')
        }
        return
      }
      toast.success(`Order ${data.order.order_ref} placed — pending fulfillment`)
      if (data.order.balance_after != null) setBalance(data.order.balance_after)
    } catch (e) {
      toast.error('Network error')
    } finally {
      setBuyingId(null)
    }
  }

  if (loading) return <div className="dashboard-page"><p>Loading gift cards…</p></div>

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h2>Gift Cards</h2>
        <div>
          {balance != null && <span style={{ marginRight: 16 }}>NGN wallet: ₦{Number(balance).toLocaleString()}</span>}
          <Link to="/gift-card-orders">My orders</Link>
          {' · '}
          <Link to="/pay">Add money</Link>
        </div>
      </div>
      <p style={{ opacity: 0.85 }}>
        Prices are in NGN. Region restrictions apply — check the card region before buying.
        Codes are delivered manually after admin fulfillment.
      </p>
      <div className="errands-grid">
        {products.length === 0 && <p>No gift cards available right now.</p>}
        {products.map((p) => (
          <div key={p.id} className="errand-card">
            <h3>{p.brand}</h3>
            <p>{p.product_name}</p>
            <p>
              Face: {p.face_currency} {Number(p.denomination).toFixed(0)} · Region: <strong>{p.region}</strong>
            </p>
            <p style={{ fontSize: '1.25rem', fontWeight: 600 }}>
              ₦{Number(p.selling_price_ngn).toLocaleString()}
            </p>
            {p.description && <p style={{ fontSize: '0.9rem' }}>{p.description}</p>}
            <button
              className="btn btn-primary"
              disabled={buyingId === p.id}
              onClick={() => buy(p)}
            >
              {buyingId === p.id ? 'Processing…' : 'Buy with wallet'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
