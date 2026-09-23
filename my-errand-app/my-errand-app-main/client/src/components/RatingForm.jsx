import React, { useState } from 'react'
import axios from 'axios'

const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })

const Star = ({ filled, onClick, onMouseEnter, onMouseLeave }) => (
  <span
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    style={{ cursor: 'pointer', fontSize: '1.4rem', color: filled ? '#f5a623' : '#dee2e6' }}
  >
    ★
  </span>
)

const RatingForm = ({ errandId, revieweeLabel = 'the other party', onSubmitted }) => {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [review, setReview] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (rating < 1) {
      setError('Pick a star rating first')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await axios.post(`/api/ratings/${errandId}`, { rating, review }, authHeaders())
      setDone(true)
      if (onSubmitted) onSubmitted()
    } catch (err) {
      if (err.response?.status === 409) {
        setDone(true) // already rated — treat as done, not an error
      } else {
        setError(err.response?.data?.error || 'Could not submit rating')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return <div style={{ fontSize: '0.85rem', color: '#2e7d32', marginTop: 8 }}>✓ Thanks for your rating</div>
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 10, padding: 10, background: '#f8f9fa', borderRadius: 8 }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>Rate {revieweeLabel}</div>
      <div>
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            filled={n <= (hoverRating || rating)}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHoverRating(n)}
            onMouseLeave={() => setHoverRating(0)}
          />
        ))}
      </div>
      <textarea
        value={review}
        onChange={(e) => setReview(e.target.value)}
        placeholder="Optional review…"
        rows={2}
        style={{ width: '100%', marginTop: 6, padding: 6, borderRadius: 6, border: '1px solid #ced4da', fontSize: '0.85rem' }}
      />
      {error && <div style={{ color: '#c62828', fontSize: '0.75rem', marginTop: 4 }}>{error}</div>}
      <button type="submit" disabled={submitting} style={{ marginTop: 6, padding: '6px 14px', borderRadius: 6 }}>
        {submitting ? 'Submitting…' : 'Submit rating'}
      </button>
    </form>
  )
}

export default RatingForm
