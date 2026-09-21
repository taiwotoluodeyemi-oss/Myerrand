import React from 'react'
import { useNavigate, Link } from 'react-router-dom'
import './Auth.css'

function UserTypeSelection() {
  const navigate = useNavigate()

  const handleClientSignup = () => {
    navigate('/register/client')
  }

  const handleRunnerSignup = () => {
    navigate('/register/runner')
  }

  return (
    <div className="auth-container">
      <div className="auth-card type-selection-card">
        <div className="auth-header">
          <h1>🏃‍♂️ My Errand</h1>
          <h2>Choose Your Account Type</h2>
          <p>Select how you'd like to use our platform</p>
        </div>

        <div className="user-type-options">
          <div
            className="user-type-card client-card"
            onClick={handleClientSignup}
          >
            <div className="type-icon">🛒</div>
            <h3>I Need Help</h3>
            <h4>Client Account</h4>
            <p>Post errands and tasks you need completed</p>
            <ul className="type-features">
              <li>Post errand requests</li>
              <li>Track progress</li>
              <li>Secure payments</li>
              <li>Rate runners</li>
              <li>Give Tips</li>
            </ul>
            <button className="type-button client-button">
              Sign Up as Client
            </button>
          </div>

          <div
            className="user-type-card runner-card"
            onClick={handleRunnerSignup}
          >
            <div className="type-icon">🚀</div>
            <h3>I Want to Earn</h3>
            <h4>Errand Runner Account</h4>
            <p>Complete errands and earn money on your schedule</p>
            <ul className="type-features">
              <li>Browse available errands</li>
              <li>Flexible schedule</li>
              <li>Instant earnings</li>
              <li>Build reputation</li>
            </ul>
            <button className="type-button runner-button">
              Sign Up as Runner
            </button>
          </div>
        </div>

        <div className="auth-footer">
          <p>
            Already have an account?{' '}
            <Link to="/login" className="auth-link">
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default UserTypeSelection
