/**
 * Loads the Google Maps JavaScript API exactly once and resolves when
 * `window.google.maps` is ready. The API key is baked in at build time via
 * webpack's DefinePlugin (see webpack.config.js) from the GOOGLE_MAPS_API_KEY
 * env var — this key is meant to be public; you restrict it in the Google
 * Cloud Console to your site's HTTP referrer(s), not by keeping it secret.
 */
const GOOGLE_MAPS_API_KEY =
  typeof process !== 'undefined' && process.env.GOOGLE_MAPS_API_KEY
    ? process.env.GOOGLE_MAPS_API_KEY
    : ''

let loadPromise = null

export const isGoogleMapsConfigured = () => Boolean(GOOGLE_MAPS_API_KEY)

export function loadGoogleMaps() {
  if (window.google?.maps) {
    return Promise.resolve(window.google.maps)
  }

  if (loadPromise) {
    return loadPromise
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error('Google Maps API key is not configured'))
  }

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&loading=async`
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google.maps)
      } else {
        reject(new Error('Google Maps script loaded but window.google.maps is missing'))
      }
    }
    script.onerror = () => {
      loadPromise = null
      reject(new Error('Failed to load the Google Maps script'))
    }
    document.head.appendChild(script)
  })

  return loadPromise
}
