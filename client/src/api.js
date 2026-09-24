/**
 * API base URL.
 * Web: leave empty for same-origin / webpack proxy.
 * Cordova APK: set at build time:
 *   API_BASE=https://your-backend.example.com CORDOVA=true npm run build
 *   (prepare-cordova also injects window.__API_BASE__)
 */
const fromProcess =
  typeof process !== 'undefined' && process.env.API_BASE
    ? process.env.API_BASE
    : ''

const fromWindow =
  typeof window !== 'undefined' && window.__API_BASE__
    ? window.__API_BASE__
    : ''

export const API_BASE = String(fromWindow || fromProcess || '').replace(/\/+$/, '')

export const apiUrl = (path) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE}${normalizedPath}`
}
