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
  const [zoneOptions, setZoneOptions] = useState([])
  const [selectedZone, setSelectedZone] = useState('')
  const [scoreboard, setScoreboard] = useState(null)
  const [supply, setSupply] = useState(null)
  const [scoreWindow, setScoreWindow] = useState(7)
  const [ops, setOps] = useState(null)
  const [observability, setObservability] = useState(null)
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
        const z = await axios.get('/api/admin/zones', { headers: headers() })
        const list = z.data?.zones || []
        setZoneOptions(list)
        const nextZone = selectedZone || list[0]?.zone || ''
        if (nextZone) setSelectedZone(nextZone)
        if (nextZone) {
          const [sc, sp] = await Promise.all([
            axios.get(`/api/admin/zones/${encodeURIComponent(nextZone)}/scoreboard?days=${scoreWindow}`, { headers: headers() }),
            axios.get(`/api/admin/zones/${encodeURIComponent(nextZone)}/supply`, { headers: headers() })
          ])
          setScoreboard(sc.data?.metrics || null)
          setSupply(sp.data || null)
        }
      } catch (_) {}
      try {
        const op = await axios.get('/api/admin/ops', { headers: headers() })
        setOps(op.data?.queues || null)
      } catch (_) { setOps(null) }
      try {
        const ob = await axios.get('/api/admin/observability', { headers: headers() })
        setObservability(ob.data?.observability || null)
      } catch (_) { setObservability(null) }
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
        <h3>Multi-zone operations</h3>
        <p>Active launch zones: {zoneOptions.filter(z => z.launch_focus && !z.pause_demand).length} / 5</p>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Zone</th><th>Health (30d)</th><th>Ready runners</th><th>Jobs 7d</th><th>Median accept</th><th>Completion</th><th>Disputes</th><th>Controls</th></tr></thead>
          <tbody>{zoneOptions.map(z => {
            const m = z.metrics_30d || {}; const m7 = z.metrics_7d || {};
            return <tr key={z.zone}>
              <td>{z.zone}</td><td>{z.health || m.color || 'INSUFFICIENT'}</td><td>{z.ready_runners ?? '—'} / 15</td>
              <td>{m7.jobs_created ?? '—'}</td><td>{m.median_accept_minutes == null ? '—' : `${Number(m.median_accept_minutes).toFixed(1)}m`}</td>
              <td>{m.completion_rate == null ? '—' : `${(m.completion_rate * 100).toFixed(1)}%`}</td><td>{m.dispute_rate == null ? '—' : `${(m.dispute_rate * 100).toFixed(1)}%`}</td>
              <td><button type="button" onClick={async () => { try { await axios.patch(`/api/admin/zones/${encodeURIComponent(z.zone)}/flags`, { launch_focus: !z.launch_focus }, { headers: headers() }); load(); } catch(e) { setError(e.response?.data?.error || 'Zone update failed'); } }}>{z.launch_focus ? 'Unfocus' : 'Launch focus'}</button>
              <button type="button" onClick={async () => { try { await axios.patch(`/api/admin/zones/${encodeURIComponent(z.zone)}/flags`, { pause_demand: !z.pause_demand }, { headers: headers() }); load(); } catch(e) { setError(e.response?.data?.error || 'Zone update failed'); } }}>{z.pause_demand ? 'Resume demand' : 'Pause demand'}</button></td>
            </tr>;
          })}</tbody>
        </table>
        {zoneOptions.length >= 2 && <div style={{ marginTop: 16 }}><strong>City rollup:</strong> <button type="button" onClick={async () => { try { const r = await axios.get('/api/admin/city-scoreboard?days=30', { headers: headers() }); const x = r.data?.rollup; setScoreboard(x || null); } catch(e) { setError(e.response?.data?.error || 'Rollup failed'); } }}>Load 30-day rollup</button></div>}
        {scoreboard && <p>Rollup/selected health: <strong>{scoreboard.status || scoreboard.color}</strong> · paid {scoreboard.jobs_paid ?? 0} · accepted {scoreboard.jobs_accepted ?? 0} · completed {scoreboard.jobs_completed ?? 0}</p>}
        <details style={{ marginTop: 12 }}><summary>Expansion checklist</summary>
          <p>Open the next zone only when the source zone is GREEN, the target is configured, and the target has at least 15 launch-ready runners.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select id="exp-source"><option value="">Source zone</option>{zoneOptions.map(z => <option key={z.zone}>{z.zone}</option>)}</select>
            <select id="exp-target"><option value="">Target zone</option>{zoneOptions.map(z => <option key={z.zone}>{z.zone}</option>)}</select>
            <button type="button" onClick={async () => { const source=document.getElementById('exp-source').value, target=document.getElementById('exp-target').value; try { const r=await axios.get(`/api/admin/expansion/checklist?source_zone=${encodeURIComponent(source)}&target_zone=${encodeURIComponent(target)}`, {headers:headers()}); alert(r.data.checklist.allowed ? 'Expansion gate met' : 'Expansion gate not met'); } catch(e) { setError(e.response?.data?.error || 'Checklist failed'); } }}>Check gate</button>
            <button type="button" onClick={async () => { const source=document.getElementById('exp-source').value, target=document.getElementById('exp-target').value; const note=window.prompt('Operator note') || ''; try { await axios.post('/api/admin/expansion-events',{from_zone:source,to_zone:target,operator_note:note},{headers:headers()}); alert('Expansion event logged'); } catch(e) { setError(e.response?.data?.error || 'Expansion not allowed'); } }}>Log expansion</button>
          </div>
        </details>
      </section>

      <section>
        <h3>Operational health</h3>
        {!observability ? <p style={{ color: '#6c757d' }}>Observability unavailable.</p> : (
          <div>
            <p>Status: <strong>{observability.healthy ? 'HEALTHY' : 'ATTENTION'}</strong> · Requests {observability.process?.requests ?? 0} · Errors {observability.process?.errors ?? 0} · Avg latency {observability.process?.latency?.avg_ms ?? 0}ms</p>
            <p>Webhook queue {observability.queue?.webhook_queue_depth ?? 0} · Dead letters {observability.queue?.webhook_dead_letters ?? 0} · Stuck holds {observability.queue?.stuck_holds ?? 0} · Active users {observability.active_users ?? 0}</p>
            <p>Deposits {observability.business?.deposits ?? 0} · Holds {observability.business?.holds ?? 0} · Releases {observability.business?.releases ?? 0} · Refunds {observability.business?.refunds ?? 0} · Payment failures {observability.business?.payment_failures ?? 0} · Open disputes {observability.business?.disputes ?? 0}</p>
            {(observability.financial_alerts || []).length > 0 && <p style={{ color: 'crimson' }}>Financial alerts: {observability.financial_alerts.map(a => `${a.type} (${a.count ?? 'error'})`).join(' · ')}</p>}
          </div>
        )}
      </section>

      <section>
        <h3>Operations queues</h3>
        {!ops ? <p style={{ color: '#6c757d' }}>Ops queues unavailable until Stage 5 schema is applied.</p> : (
          <>
            <p>Open disputes: <strong>{ops.open_disputes?.length || 0}</strong> · Stuck holds: <strong>{ops.stuck_holds?.length || 0}</strong> · Due releases: <strong>{ops.due_releases?.length || 0}</strong> · Near expiry: <strong>{ops.paid_unaccepted_near_expiry?.length || 0}</strong> · Webhook dead letters: <strong>{ops.webhook_dead_letters?.length || 0}</strong></p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={async () => { try { await axios.post('/api/admin/ops/process-due-money', {}, { headers: headers() }); await load(); } catch(e) { setError(e.response?.data?.error || 'Money queue processing failed'); } }}>Process due money</button>
              <button type="button" onClick={async () => { try { await axios.post('/api/admin/ops/process-webhooks', {}, { headers: headers() }); await load(); } catch(e) { setError(e.response?.data?.error || 'Webhook processing failed'); } }}>Process webhooks</button>
            </div>
            {(ops.webhook_dead_letters || []).length > 0 && (
              <table style={{ marginTop: 12 }}>
                <thead><tr><th>Delivery</th><th>URL</th><th>Attempts</th><th>Error</th><th>Action</th></tr></thead>
                <tbody>{ops.webhook_dead_letters.slice(0, 20).map(d => <tr key={d.id}><td>#{d.id}</td><td>{d.url}</td><td>{d.attempts}</td><td>{d.last_error || '—'}</td><td><button type="button" onClick={async () => { try { await axios.post(`/api/admin/ops/webhook-dead-letter/${d.id}/retry`, {}, { headers: headers() }); await load(); } catch(e) { setError(e.response?.data?.error || 'Retry failed'); } }}>Retry</button></td></tr>)}</tbody>
              </table>
            )}
          </>
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
