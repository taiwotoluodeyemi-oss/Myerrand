// Server-side geocoding: turns a plain-text address into { lat, lng } using
// the Google Geocoding API.
//
// This is deliberately a DIFFERENT key from the one the browser uses to
// render the map (GOOGLE_MAPS_API_KEY, wired in via webpack for the
// client). That key is public by design and restricted in the Google Cloud
// Console to specific HTTP referrers (your domain). This one runs on the
// server, is never sent to the browser, and should instead be restricted
// to your server's IP address(es) and to the Geocoding API only. Sharing
// one key across both would force you to choose between "restricted to my
// domain" and "restricted to my server IP" — Google only lets a key have
// one type of application restriction at a time.
const axios = require('axios');

const GOOGLE_GEOCODING_KEY = process.env.GOOGLE_MAPS_SERVER_KEY;

const isGeocodingConfigured = () => Boolean(GOOGLE_GEOCODING_KEY);

/**
 * @param {string} address
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
async function geocodeAddress(address) {
  if (!address || !isGeocodingConfigured()) return null;

  try {
    const { data } = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address, key: GOOGLE_GEOCODING_KEY },
      timeout: 8000
    });

    if (data.status !== 'OK' || !data.results?.[0]?.geometry?.location) {
      if (data.status !== 'ZERO_RESULTS') {
        console.warn(`Geocoding failed for "${address}": ${data.status} ${data.error_message || ''}`);
      }
      return null;
    }

    const { lat, lng } = data.results[0].geometry.location;
    return { lat, lng };
  } catch (error) {
    console.error('Geocoding request failed:', error.message);
    return null;
  }
}

module.exports = { geocodeAddress, isGeocodingConfigured };
