/**
 * Pricing engine tests — run with: node --test tests/pricing.test.js
 * Does not require a live DB or Google Maps key.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Ensure Maps key is absent so we exercise haversine fallback
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.GOOGLE_MAPS_SERVER_KEY;

// Stable rates for assertions
process.env.BASE_FARE = '200';
process.env.RATE_PER_KM_BICYCLE = '120';
process.env.RATE_PER_KM_CAR = '350';
process.env.FUEL_L_PER_KM_CAR = '0.12';
process.env.FUEL_L_PER_KM_MOTORCYCLE = '0.04';
process.env.FUEL_PRICE_NGN_PER_LITRE = '1000';
process.env.PLATFORM_FEE_PERCENT = '0.15';
process.env.VAT_PERCENT = '0.075';
process.env.URGENCY_MULT_MEDIUM = '1.0';
process.env.ROAD_FACTOR = '1.3';

const { calculateErrandPrice, haversineKm } = require('../utils/pricing');

// ~5 km straight-line between two Lagos points (approx)
const PICKUP = { lat: 6.5244, lng: 3.3792 }; // Lagos Island-ish
const DROP = { lat: 6.4654, lng: 3.4064 };   // Victoria Island-ish

describe('pricing engine', () => {
  it('haversine returns a positive distance', () => {
    const d = haversineKm(PICKUP.lat, PICKUP.lng, DROP.lat, DROP.lng);
    assert.ok(d > 0);
    assert.ok(d < 50);
  });

  it('same distance produces higher quote for car than bicycle', async () => {
    const bike = await calculateErrandPrice({
      pickup_lat: PICKUP.lat,
      pickup_lng: PICKUP.lng,
      delivery_lat: DROP.lat,
      delivery_lng: DROP.lng,
      mode: 'bicycle',
      urgency: 'medium',
    });
    const car = await calculateErrandPrice({
      pickup_lat: PICKUP.lat,
      pickup_lng: PICKUP.lng,
      delivery_lat: DROP.lat,
      delivery_lng: DROP.lng,
      mode: 'car',
      urgency: 'medium',
    });
    assert.equal(bike.distance_km, car.distance_km);
    assert.ok(car.client_total > bike.client_total, `car ${car.client_total} should be > bike ${bike.client_total}`);
    assert.equal(bike.fuel_cost, 0);
    assert.ok(car.fuel_cost > 0);
  });

  it('VAT is computed on (subtotal + platform_fee), never on client_total', async () => {
    const q = await calculateErrandPrice({
      pickup_lat: PICKUP.lat,
      pickup_lng: PICKUP.lng,
      delivery_lat: DROP.lat,
      delivery_lng: DROP.lng,
      mode: 'motorcycle',
      urgency: 'medium',
    });
    const expectedVat = Math.round(((q.subtotal + q.platform_fee) * 0.075 + Number.EPSILON) * 100) / 100;
    assert.equal(q.vat, expectedVat);
    // Must NOT be tax-on-tax (VAT on client_total would be higher)
    const taxOnTax = Math.round((q.client_total * 0.075 + Number.EPSILON) * 100) / 100;
    assert.ok(q.vat < taxOnTax || q.vat === expectedVat);
    assert.equal(q.vat_rate, 0.075);
    // client_total = subtotal + platform_fee + vat
    const expectedTotal = Math.round((q.subtotal + q.platform_fee + q.vat + Number.EPSILON) * 100) / 100;
    assert.equal(q.client_total, expectedTotal);
    // runner gets subtotal only
    assert.equal(q.runner_payout, q.subtotal);
  });

  it('returns a usable estimate when GOOGLE_MAPS_API_KEY is absent', async () => {
    assert.equal(process.env.GOOGLE_MAPS_API_KEY, undefined);
    assert.equal(process.env.GOOGLE_MAPS_SERVER_KEY, undefined);
    const q = await calculateErrandPrice({
      pickup_lat: PICKUP.lat,
      pickup_lng: PICKUP.lng,
      delivery_lat: DROP.lat,
      delivery_lng: DROP.lng,
      mode: 'foot',
      urgency: 'medium',
    });
    assert.ok(q.distance_km > 0);
    assert.ok(q.client_total > 0);
    assert.ok(typeof q.base_fare === 'number');
    assert.ok(typeof q.platform_fee === 'number');
    assert.ok(typeof q.vat === 'number');
    assert.equal(q.mode, 'foot');
    assert.equal(q.fuel_cost, 0);
  });
});
