// Server-side geocoding: turns a plain-text address into { lat, lng }.
// Prefers Google Geocoding API when GOOGLE_MAPS_SERVER_KEY is set;
// falls back to free OpenStreetMap Nominatim so quotes work without keys.
const axios = require('axios');

const GOOGLE_GEOCODING_KEY = process.env.GOOGLE_MAPS_SERVER_KEY;

const isGeocodingConfigured = () => Boolean(GOOGLE_GEOCODING_KEY);

/**
 * @param {string} address
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
async function geocodeAddress(address) {
  if (!address) return null;

  // Prefer Google if configured
  if (isGeocodingConfigured()) {
    try {
      const { data } = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
        params: { address, key: GOOGLE_GEOCODING_KEY },
        timeout: 8000
      });

      if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
        const { lat, lng } = data.results[0].geometry.location;
        return { lat, lng };
      }
      if (data.status !== 'ZERO_RESULTS') {
        console.warn(`Geocoding failed for "${address}": ${data.status} ${data.error_message || ''}`);
      }
    } catch (error) {
      console.error('Google geocoding request failed:', error.message);
    }
  }

  // Fallback: OpenStreetMap Nominatim (free, no key; respect usage policy)
  try {
    const { data } = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: address,
        format: 'json',
        limit: 1
      },
      headers: {
        'User-Agent': 'MyErrandApp/1.0 (contact@myerrand.example)'
      },
      timeout: 10000
    });
    if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (error) {
    console.error('Nominatim geocoding failed:', error.message);
  }

  return null;
}

module.exports = { geocodeAddress, isGeocodingConfigured };
