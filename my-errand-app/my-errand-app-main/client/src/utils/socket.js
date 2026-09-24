/**
 * Loads the Socket.IO client from a CDN (pinned to match the server's
 * socket.io version — see package.json) and returns a connected,
 * JWT-authenticated singleton socket. Using a CDN script tag instead of an
 * npm dependency keeps this consistent with utils/googleMaps.js.
 */
import { API_BASE } from '../api'

const SOCKET_IO_CDN_URL = 'https://cdn.socket.io/4.8.1/socket.io.min.js'

let scriptPromise = null
let socketInstance = null

function loadScript() {
  if (window.io) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SOCKET_IO_CDN_URL
    script.async = true
    script.onload = () => (window.io ? resolve() : reject(new Error('socket.io script loaded but window.io is missing')))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Failed to load the Socket.IO client script'))
    }
    document.head.appendChild(script)
  })

  return scriptPromise
}

export async function getSocket() {
  if (socketInstance) return socketInstance

  await loadScript()

  const token = localStorage.getItem('token')

  socketInstance = window.io(API_BASE || window.location.origin, {
    auth: { token },
    transports: ['websocket', 'polling']
  })

  return socketInstance
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect()
    socketInstance = null
  }
}
