import React from 'react'
import { Link } from 'react-router-dom'
import './Auth.css'

export default function Privacy() {
  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: 720, textAlign: 'left' }}>
        <h1>Privacy Policy</h1>
        <p>Last updated: September 2026</p>
        <p>
          We collect account details (name, email, phone, address), errand content, payment/wallet
          metadata, and optional verification documents to operate the marketplace.
        </p>
        <p>
          Data is used to match clients and runners, process escrow payments, prevent fraud, and
          improve the service. We do not sell personal data. Access is restricted by role.
        </p>
        <p>
          You may request profile updates or account deactivation from the Profile page. Financial
          records may be retained where required for compliance.
        </p>
        <p>
          Replace this draft with a jurisdiction-specific policy before public launch.
        </p>
        <p><Link to="/register">Back to registration</Link> · <Link to="/terms">Terms of Service</Link></p>
      </div>
    </div>
  )
}
