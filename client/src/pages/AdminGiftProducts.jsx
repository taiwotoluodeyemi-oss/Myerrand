import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import './Dashboard.css'

const empty = {
  brand: '', product_name: '', denomination: '', face_currency: 'USD',
  region: 'United States', selling_price_ngn: '', supplier_cost_ngn: '',
  description: '', status: 'active'
}

export default function AdminGiftProducts() {
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(empty)
  const [editingId, setEditingId] = useState(null)
  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` })

  const load = async () => {
    try {
      const r = await axios.get('/api/admin/gift-card-products', { headers: headers() })
      setProducts(r.data.products || [])
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to load products')
    }
  }
  useEffect(() => { load() }, [])

  const save = async (e) => {
    e.preventDefault()
    try {
      if (editingId) {
        await axios.patch(`/api/admin/gift-card-products/${editingId}`, form, { headers: headers() })
        toast.success('Product updated')
      } else {
        await axios.post('/api/admin/gift-card-products', form, { headers: headers() })
        toast.success('Product created')
      }
      setForm(empty)
      setEditingId(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed')
    }
  }

  const edit = (p) => {
    setEditingId(p.id)
    setForm({
      brand: p.brand,
      product_name: p.product_name,
      denomination: p.denomination,
      face_currency: p.face_currency,
      region: p.region,
      selling_price_ngn: p.selling_price_ngn,
      supplier_cost_ngn: p.supplier_cost_ngn || '',
      description: p.description || '',
      status: p.status
    })
  }

  return (
    <div className="dashboard">
      <h2>Gift card products</h2>
      <form onSubmit={save} style={{ maxWidth: 480, marginBottom: 24 }}>
        {['brand', 'product_name', 'denomination', 'face_currency', 'region', 'selling_price_ngn', 'supplier_cost_ngn', 'description'].map((k) => (
          <div key={k} className="form-group">
            <label>{k}</label>
            <input
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              required={['brand', 'product_name', 'denomination', 'selling_price_ngn'].includes(k)}
            />
          </div>
        ))}
        <div className="form-group">
          <label>status</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary">{editingId ? 'Update' : 'Create'}</button>
        {editingId && <button type="button" className="btn" onClick={() => { setEditingId(null); setForm(empty) }}>Cancel</button>}
      </form>
      <table>
        <thead>
          <tr><th>Brand</th><th>Name</th><th>Face</th><th>Region</th><th>Price NGN</th><th>Cost</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>{p.brand}</td>
              <td>{p.product_name}</td>
              <td>{p.face_currency} {p.denomination}</td>
              <td>{p.region}</td>
              <td>₦{Number(p.selling_price_ngn).toLocaleString()}</td>
              <td>{p.supplier_cost_ngn != null ? `₦${Number(p.supplier_cost_ngn).toLocaleString()}` : '—'}</td>
              <td>{p.status}</td>
              <td><button type="button" onClick={() => edit(p)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
