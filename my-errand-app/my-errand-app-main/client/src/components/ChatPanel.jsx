import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { getSocket } from '../utils/socket'

const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })

const ChatPanel = ({ errandId, currentUserId }) => {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const listRef = useRef(null)

  useEffect(() => {
    let socket
    let cancelled = false

    const fetchHistory = async () => {
      try {
        const response = await axios.get(`/api/messages/${errandId}`, authHeaders())
        if (!cancelled) setMessages(response.data?.data?.messages || [])
      } catch (err) {
        if (!cancelled) setError('Could not load messages')
      }
    }

    fetchHistory()

    getSocket().then((s) => {
      socket = s
      socket.emit('join', `errand:${errandId}`)
      socket.on('message', (msg) => {
        if (String(msg.errand_id) === String(errandId)) {
          setMessages((prev) => [...prev, msg])
        }
      })
    }).catch(() => { /* chat still works via REST send + refetch below */ })

    return () => {
      cancelled = true
      if (socket) {
        socket.emit('leave', `errand:${errandId}`)
        socket.off('message')
      }
    }
  }, [errandId])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  const sendMessage = async (e) => {
    e.preventDefault()
    const content = draft.trim()
    if (!content || sending) return

    setSending(true)
    setError(null)
    try {
      const response = await axios.post(`/api/messages/${errandId}`, { content }, authHeaders())
      // Add locally too — the socket broadcast excludes the sender in some
      // setups, and this keeps the UI snappy even if the socket is down.
      const sent = response.data?.data?.message
      if (sent) {
        setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]))
      }
      setDraft('')
    } catch (err) {
      setError(err.response?.data?.error || 'Message failed to send')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="chat-panel" style={{ border: '1px solid #e9ecef', borderRadius: 8, marginTop: 12 }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #e9ecef', fontWeight: 600, fontSize: '0.85rem' }}>
        💬 Chat
      </div>
      <div ref={listRef} style={{ maxHeight: 220, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {messages.length === 0 && <div style={{ color: '#adb5bd', fontSize: '0.8rem' }}>No messages yet — say hello</div>}
        {messages.map((m) => {
          const mine = m.sender_id === currentUserId
          return (
            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              {!mine && <div style={{ fontSize: '0.7rem', color: '#adb5bd' }}>{m.sender_name}</div>}
              <div style={{
                background: mine ? '#1565c0' : '#f1f3f5',
                color: mine ? '#fff' : '#212529',
                borderRadius: 12,
                padding: '6px 10px',
                fontSize: '0.85rem'
              }}>
                {m.content}
              </div>
            </div>
          )
        })}
      </div>
      {error && <div style={{ color: '#c62828', fontSize: '0.75rem', padding: '0 12px' }}>{error}</div>}
      <form onSubmit={sendMessage} style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: '1px solid #e9ecef' }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          maxLength={2000}
          style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #ced4da' }}
        />
        <button type="submit" disabled={sending || !draft.trim()} style={{ padding: '6px 14px', borderRadius: 6 }}>
          Send
        </button>
      </form>
    </div>
  )
}

export default ChatPanel
