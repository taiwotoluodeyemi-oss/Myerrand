import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { apiUrl } from '../api'
import { loadGoogleMaps, isGoogleMapsConfigured } from '../utils/googleMaps'

const POLL_INTERVAL_MS = 8000

// Renders pickup/delivery pins for an errand, plus the runner's live
// position while the errand is assigned or in progress. Polls the tracking
// endpoint on an interval rather than opening a socket — simple, and plenty
// fast enough for "where's my runner" at walking/driving speed.
const ErrandTrackingMap = ({ errandId, status, pickupAddress, deliveryAddress }) => {
  const mapDivRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({ pickup: null, delivery: null, runner: null })
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!isGoogleMapsConfigured()) {
      setError('not-configured')
      return
    }

    let cancelled = false
    let pollTimer = null

    const fetchAndRender = async () => {
      try {
        const response = await axios.get(apiUrl(`/api/errands/${errandId}/tracking`), {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        })
        if (cancelled) return
        const data = response.data?.data
        if (!data) return

        const maps = window.google.maps
        const map = mapRef.current
        const bounds = new maps.LatLngBounds()
        let hasPoint = false

        const placeMarker = (key, point, opts) => {
          if (!point) {
            if (markersRef.current[key]) {
              markersRef.current[key].setMap(null)
              markersRef.current[key] = null
            }
            return
          }
          const position = { lat: point.lat, lng: point.lng }
          if (markersRef.current[key]) {
            markersRef.current[key].setPosition(position)
          } else {
            markersRef.current[key] = new maps.Marker({ map, position, ...opts })
          }
          bounds.extend(position)
          hasPoint = true
        }

        placeMarker('pickup', data.pickup, {
          label: { text: 'P', color: '#fff' },
          icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#2e7d32', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          title: 'Pickup: ' + (data.pickup?.address || '')
        })
        placeMarker('delivery', data.delivery, {
          label: { text: 'D', color: '#fff' },
          icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#c62828', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          title: 'Delivery: ' + (data.delivery?.address || '')
        })
        placeMarker('runner', data.runner, {
          icon: { path: maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 5, fillColor: '#1565c0', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
          title: 'Runner' + (data.runner?.updatedAt ? ` (updated ${new Date(data.runner.updatedAt).toLocaleTimeString()})` : '')
        })

        if (hasPoint) {
          if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
            map.setCenter(bounds.getCenter())
            map.setZoom(14)
          } else {
            map.fitBounds(bounds, 60)
          }
        }

        setError(data.geocodingConfigured === false && !data.pickup && !data.delivery ? 'no-coordinates' : null)
      } catch (err) {
        if (!cancelled) setError('fetch-failed')
      }
    }

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapDivRef.current) return
        mapRef.current = new window.google.maps.Map(mapDivRef.current, {
          center: { lat: 0, lng: 0 },
          zoom: 2,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false
        })
        setLoaded(true)
        fetchAndRender()

        if (['assigned', 'in_progress'].includes(status)) {
          pollTimer = setInterval(fetchAndRender, POLL_INTERVAL_MS)
        }
      })
      .catch(() => {
        if (!cancelled) setError('load-failed')
      })

    return () => {
      cancelled = true
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [errandId, status])

  if (error === 'not-configured') {
    return (
      <div className="mini-map">
        <div className="map-placeholder">
          🗺️ Map not available (Google Maps API key not configured)
          <div className="map-details">
            <div><strong>From:</strong> {pickupAddress || 'N/A'}</div>
            <div><strong>To:</strong> {deliveryAddress || 'N/A'}</div>
          </div>
        </div>
      </div>
    )
  }

  if (error === 'load-failed' || error === 'fetch-failed') {
    return (
      <div className="mini-map">
        <div className="map-placeholder">
          🗺️ Map couldn't load right now
          <div className="map-details">
            <div><strong>From:</strong> {pickupAddress || 'N/A'}</div>
            <div><strong>To:</strong> {deliveryAddress || 'N/A'}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mini-map" style={{ padding: 0, overflow: 'hidden' }}>
      <div ref={mapDivRef} style={{ width: '100%', height: 220, background: '#f8f9fa' }} />
      {!loaded && <div className="map-placeholder">🗺️ Loading map…</div>}
      {error === 'no-coordinates' && (
        <div className="map-details" style={{ padding: '8px 12px' }}>
          <div><strong>From:</strong> {pickupAddress || 'N/A'}</div>
          <div><strong>To:</strong> {deliveryAddress || 'N/A'}</div>
        </div>
      )}
    </div>
  )
}

export default ErrandTrackingMap
