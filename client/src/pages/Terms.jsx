import React from 'react'
import { Link } from 'react-router-dom'
import './Auth.css'

export default function Terms() {
  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: 720, textAlign: 'left' }}>
        <h1>Terms of Service</h1>
        <p>Last updated: September 2026</p>
        <p>
          By using My Errand App you agree to use the platform lawfully, provide accurate information,
          and honor payments for accepted errands. Runners must complete assigned work professionally.
          The platform holds client funds in escrow until completion where applicable.
        </p>
        <p>
          We may suspend accounts that abuse the service, attempt payment fraud, or violate applicable law.
          Wallet balances and transaction records are maintained for operational and audit purposes.
        </p>
        <p>
          These terms are a working draft for the product. Replace this text with counsel-reviewed terms
          before public launch.
        </p>
        <p><Link to="/register">Back to registration</Link> · <Link to="/privacy">Privacy Policy</Link></p>
      </div>
    </div>
  )
}
