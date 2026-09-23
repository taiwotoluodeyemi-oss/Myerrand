/**
 * Server-side errand pricing engine.
 *
 * All rates come from env vars (or sane defaults) so fuel prices, tax rates,
 * and per-mode rates can change without code deploys.
 *
 * Distance: Google Distance Matrix when a Maps key is present; otherwise
 * haversine straight-line × ROAD_FACTOR (default 1.3). Never fails the quote
 * solely because the Maps key is missing.
 */

const toNum = (v, fallback) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Per-mode transport config (rate_per_km, fuel_consumption_l_per_km). */
function getModeConfig(mode) {
  const key = String(mode || 'motorcycle').toLowerCase();
  const configs = {
    foot: {
      rate_per_km: toNum(process.env.RATE_PER_KM_FOOT, 80),
      fuel_consumption_l_per_km: 0,
      applicable: true,
    },
    bicycle: {
      rate_per_km: toNum(process.env.RATE_PER_KM_BICYCLE, 120),
      fuel_consumption_l_per_km: 0,
      applicable: true,
    },
    motorcycle: {
      rate_per_km: toNum(process.env.RATE_PER_KM_MOTORCYCLE, 200),
      fuel_consumption_l_per_km: toNum(process.env.FUEL_L_PER_KM_MOTORCYCLE, 0.04),
      applicable: true,
    },
    car: {
      rate_per_km: toNum(process.env.RATE_PER_KM_CAR, 350),
      fuel_consumption_l_per_km: toNum(process.env.FUEL_L_PER_KM_CAR, 0.12),
      applicable: true,
    },
  };
  return configs[key] || configs.motorcycle;
}

function getUrgencyMultiplier(urgency) {
  const u = String(urgency || 'normal').toLowerCase();
  const map = {
    low: toNum(process.env.URGENCY_MULT_LOW, 1.0),
    normal: toNum(process.env.URGENCY_MULT_NORMAL, 1.0),
    medium: toNum(process.env.URGENCY_MULT_MEDIUM, 1.0),
    high: toNum(process.env.URGENCY_MULT_HIGH, 1.15),
    urgent: toNum(process.env.URGENCY_MULT_URGENT, 1.3),
  };
  return map[u] != null ? map[u] : map.normal;
}

/**
 * Haversine distance in km between two WGS84 points.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Prefer Google Distance Matrix; fall back to haversine × road factor.
 * Never throws solely because the API key is missing.
 */
async function getDistanceKm(pickup_lat, pickup_lng, delivery_lat, delivery_lng) {
  const key =
    process.env.GOOGLE_MAPS_SERVER_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';
  const roadFactor = toNum(process.env.ROAD_FACTOR, 1.3);

  if (key) {
    try {
      // Lazy require so unit tests work without a full node_modules install
      const axios = require('axios');
      const { data } = await axios.get(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        {
          params: {
            origins: `${pickup_lat},${pickup_lng}`,
            destinations: `${delivery_lat},${delivery_lng}`,
            mode: 'driving',
            units: 'metric',
            key,
          },
          timeout: 8000,
        }
      );
      const element = data?.rows?.[0]?.elements?.[0];
      if (data.status === 'OK' && element?.status === 'OK' && element.distance?.value != null) {
        return element.distance.value / 1000; // metres → km
      }
    } catch (err) {
      // Fall through to haversine — quote must still succeed.
      console.warn('[pricing] Distance Matrix failed, using haversine:', err.message);
    }
  }

  const straight = haversineKm(pickup_lat, pickup_lng, delivery_lat, delivery_lng);
  return straight * roadFactor;
}

/**
 * Calculate full errand price breakdown.
 *
 * @param {{ pickup_lat, pickup_lng, delivery_lat, delivery_lng, mode, urgency }} params
 * @returns {Promise<object>} breakdown
 */
async function calculateErrandPrice({
  pickup_lat,
  pickup_lng,
  delivery_lat,
  delivery_lng,
  mode = 'motorcycle',
  urgency = 'normal',
}) {
  const plat = parseFloat(pickup_lat);
  const plng = parseFloat(pickup_lng);
  const dlat = parseFloat(delivery_lat);
  const dlng = parseFloat(delivery_lng);

  if (![plat, plng, dlat, dlng].every(Number.isFinite)) {
    const err = new Error('pickup_lat, pickup_lng, delivery_lat, delivery_lng are required and must be numbers');
    err.status = 400;
    throw err;
  }

  const modeCfg = getModeConfig(mode);
  if (!modeCfg.applicable) {
    const err = new Error(`Mode "${mode}" is not available for pricing`);
    err.status = 400;
    throw err;
  }

  const distance_km = round2(await getDistanceKm(plat, plng, dlat, dlng));
  const base_fare = toNum(process.env.BASE_FARE, 200);
  const fuel_price_per_litre = toNum(process.env.FUEL_PRICE_NGN_PER_LITRE, 950);
  const urgency_multiplier = getUrgencyMultiplier(urgency);

  const distance_cost = round2(distance_km * modeCfg.rate_per_km);
  const fuel_cost = round2(
    distance_km * modeCfg.fuel_consumption_l_per_km * fuel_price_per_litre
  );

  // subtotal before platform fee / VAT, after urgency
  const raw_subtotal = base_fare + distance_cost + fuel_cost;
  const urgency_fee = round2(raw_subtotal * (urgency_multiplier - 1));
  const subtotal = round2(raw_subtotal * urgency_multiplier);

  const platform_fee_percent = toNum(process.env.PLATFORM_FEE_PERCENT, 0.15);
  const vat_rate = toNum(process.env.VAT_PERCENT, 0.075); // Nigeria VAT 7.5%

  const platform_fee = round2(subtotal * platform_fee_percent);
  // VAT is on (subtotal + platform_fee) — never on client_total (no tax-on-tax)
  const vat = round2((subtotal + platform_fee) * vat_rate);
  const client_total = round2(subtotal + platform_fee + vat);
  // Runner receives subtotal (base + distance + fuel + urgency); platform keeps fee + VAT
  const runner_payout = subtotal;

  return {
    distance_km,
    mode: String(mode || 'motorcycle').toLowerCase(),
    base_fare: round2(base_fare),
    distance_cost,
    fuel_cost,
    urgency_fee,
    urgency_multiplier,
    subtotal,
    platform_fee,
    platform_fee_percent,
    vat,
    vat_rate,
    client_total,
    runner_payout,
  };
}

module.exports = {
  calculateErrandPrice,
  getModeConfig,
  getUrgencyMultiplier,
  haversineKm,
  getDistanceKm,
};
