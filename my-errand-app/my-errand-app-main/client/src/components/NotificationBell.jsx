import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { getSocket } from '../utils/socket'

const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })

const NotificationBell = () => {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef(null)

  const fetchNotifications = async () => {
    try {
      const response = await axios.get('/api/notifications', authHeaders())
      const data = response.data?.data
      if (data) {
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch (err) {
      // best-effort — bell just shows stale/no data until the next poll
    }
  }

  useEffect(() => {
    fetchNotifications()
    const pollTimer = setInterval(fetchNotifications, 20000)

    let socket
    getSocket().then((s) => {
      socket = s
      const userId = JSON.parse(localStorage.getItem('user') || '{}')?.id
      if (userId) socket.emit('join', `user:${userId}`)
      socket.on('notification', (payload) => {
        setNotifications((prev) => [{ ...payload, id: payload.id, is_read: false, created_at: payload.createdAt }, ...prev].slice(0, 50))
        setUnreadCount((prev) => prev + 1)
      })
    }).catch(() => { /* live push unavailable — polling still covers it */ })

    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      clearInterval(pollTimer)
      if (socket) socket.off('notification')
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const markAllRead = async () => {
    setUnreadCount(0)
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    try {
      await axios.post('/api/notifications/read-all', {}, authHeaders())
    } catch (err) { /* ignore */ }
  }

  const markOneRead = async (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    setUnreadCount((prev) => Math.max(0, prev - 1))
    try {
      await axios.post(`/api/notifications/${id}/read`, {}, authHeaders())
    } catch (err) { /* ignore */ }
  }

  return (
    <div className="notification-bell" ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="notification-bell-btn"
        aria-label="Notifications"
        style={{ position: 'relative', background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4, background: '#c62828', color: '#fff',
            borderRadius: '50%', fontSize: '0.65rem', padding: '1px 5px', minWidth: 16
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '130%', width: 320, maxHeight: 400, overflowY: 'auto',
          background: '#fff', border: '1px solid #e9ecef', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          zIndex: 1000
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #e9ecef' }}>
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: '#1565c0', cursor: 'pointer', fontSize: '0.8rem' }}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: 16, color: '#6c757d', fontSize: '0.85rem' }}>No notifications yet</div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.is_read && markOneRead(n.id)}
                style={{
                  padding: '10px 14px', borderBottom: '1px solid #f1f3f5', cursor: n.is_read ? 'default' : 'pointer',
                  background: n.is_read ? '#fff' : '#f0f7ff'
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{n.title}</div>
                <div style={{ fontSize: '0.8rem', color: '#495057' }}>{n.message}</div>
                <div style={{ fontSize: '0.7rem', color: '#adb5bd', marginTop: 2 }}>
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default NotificationBell
