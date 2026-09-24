// Central place to check whether a payment provider has real credentials
// configured. Routes use these guards so that a method only "comes alive"
// once the corresponding .env values are filled in on the server — instead
// of silently pretending to succeed.

const isPaystackConfigured = () =>
  Boolean(
    process.env.PAYSTACK_SECRET_KEY &&
    process.env.PAYSTACK_PUBLIC_KEY &&
    !String(process.env.PAYSTACK_SECRET_KEY).includes('your_')
  );

const isPaypalConfigured = () =>
  Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);

const isPaypalPayoutsConfigured = () =>
  isPaypalConfigured() && process.env.PAYPAL_PAYOUTS_ENABLED === 'true';

/** True when real Paystack/PayPal secrets are not configured. */
const isMockPaymentMode = () => !(isPaystackConfigured() || isPaypalConfigured());

module.exports = {
  isPaystackConfigured,
  isPaypalConfigured,
  isPaypalPayoutsConfigured,
  isMockPaymentMode
};
