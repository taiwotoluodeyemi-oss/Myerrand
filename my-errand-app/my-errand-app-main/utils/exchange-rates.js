/**
 * Exchange rates: DB cache first, then free live API (Frankfurter — ECB-based, no API key).
 * Note: Frankfurter covers major ISO currencies; some African pairs may need USD cross.
 */
const axios = require('axios');

async function fetchLiveRate(from, to) {
  from = String(from).toUpperCase();
  to = String(to).toUpperCase();
  if (from === to) return 1;

  // Direct
  try {
    const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const { data } = await axios.get(url, { timeout: 8000 });
    if (data && data.rates && data.rates[to] != null) {
      return Number(data.rates[to]);
    }
  } catch (_) {
    /* try cross via USD */
  }

  // Cross via USD if direct fails (helps some pairs)
  if (from !== 'USD' && to !== 'USD') {
    try {
      const [a, b] = await Promise.all([
        axios.get(`https://api.frankfurter.app/latest?from=${from}&to=USD`, { timeout: 8000 }),
        axios.get(`https://api.frankfurter.app/latest?from=USD&to=${to}`, { timeout: 8000 }),
      ]);
      const toUsd = a.data?.rates?.USD;
      const usdTo = b.data?.rates?.[to];
      if (toUsd != null && usdTo != null) return Number(toUsd) * Number(usdTo);
    } catch (_) {}
  }

  return null;
}

/**
 * @param {import('mysql2/promise').Pool} db
 */
async function getExchangeRate(db, fromCurrency, toCurrency) {
  const from = String(fromCurrency).toUpperCase();
  const to = String(toCurrency).toUpperCase();
  if (from === to) return { rate: 1, source: 'identity' };

  // 1) Fresh DB row
  try {
    const [rows] = await db.execute(
      `SELECT rate FROM currency_rates
       WHERE from_currency = ? AND to_currency = ?
         AND (valid_until IS NULL OR valid_until > NOW())
       ORDER BY created_at DESC LIMIT 1`,
      [from, to]
    );
    if (rows[0]?.rate != null) {
      return { rate: Number(rows[0].rate), source: 'database' };
    }
  } catch (_) {
    /* table may not exist yet */
  }

  // 2) Live API
  const live = await fetchLiveRate(from, to);
  if (live != null && live > 0) {
    try {
      await db.execute(
        `INSERT INTO currency_rates (from_currency, to_currency, rate, valid_until)
         VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 12 HOUR))`,
        [from, to, live]
      );
    } catch (_) {
      /* cache best-effort */
    }
    return { rate: live, source: 'live' };
  }

  // 3) Unsafe fallback — caller should treat carefully
  return { rate: 1, source: 'fallback' };
}

module.exports = { getExchangeRate, fetchLiveRate };
