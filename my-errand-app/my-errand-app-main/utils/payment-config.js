// Central place to check whether a payment provider has real credentials
// configured. Routes use these guards so that a method only "comes alive"
// once the corresponding .env values are filled in on the server — instead
// of silently pretending to succeed.

const isPaystackConfigured = () =>
  Boolean(process.env.PAYSTACK_SECRET_KEY && process.env.PAYSTACK_PUBLIC_KEY);

const isPaypalConfigured = () =>
  Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);

// PayPal payouts require an extra scope/product enabled on the app, so we
// let deployers explicitly confirm it's ready instead of assuming.
const isPaypalPayoutsConfigured = () =>
  isPaypalConfigured() && process.env.PAYPAL_PAYOUTS_ENABLED === 'true';

module.exports = {
  isPaystackConfigured,
  isPaypalConfigured,
  isPaypalPayoutsConfigured
};
