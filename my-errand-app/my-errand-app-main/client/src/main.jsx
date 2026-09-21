import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import './i18n'
import { isCordova, waitForCordova } from './cordova'

function pickRouter() {
  const cordovaBuild = typeof process !== 'undefined' && process.env.CORDOVA === 'true'
  if (cordovaBuild) return HashRouter
  if (typeof window !== 'undefined') {
    if (isCordova() || window.location.protocol === 'file:') return HashRouter
  }
  return BrowserRouter
}

function initializeApp() {
  waitForCordova(() => {
    const rootElement = document.getElementById('root')
    if (!rootElement) {
      document.body.innerHTML =
        '<h1 style="color:red;text-align:center;margin-top:50px">Root element not found</h1>'
      return
    }
    const Router = pickRouter()
    createRoot(rootElement).render(
      <React.StrictMode>
        <Router>
          <App />
        </Router>
      </React.StrictMode>
    )
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp)
} else {
  initializeApp()
}
