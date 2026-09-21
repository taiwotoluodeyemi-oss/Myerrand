/** Supported currencies for international wallets & display */
const currencies = [
  { code: 'USD', symbol: '$', name: 'US Dollar', region: 'global' },
  { code: 'EUR', symbol: '€', name: 'Euro', region: 'eu' },
  { code: 'GBP', symbol: '£', name: 'British Pound', region: 'uk' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', region: 'africa' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', region: 'africa' },
  { code: 'GHS', symbol: '₵', name: 'Ghanaian Cedi', region: 'africa' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', region: 'africa' },
  { code: 'EGP', symbol: 'E£', name: 'Egyptian Pound', region: 'africa' },
  { code: 'MAD', symbol: 'MAD', name: 'Moroccan Dirham', region: 'africa' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar', region: 'americas' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', region: 'apac' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', region: 'apac' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', region: 'apac' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', region: 'apac' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', region: 'americas' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso', region: 'americas' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', region: 'mena' },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal', region: 'mena' },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira', region: 'mena' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc', region: 'eu' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona', region: 'eu' },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone', region: 'eu' },
  { code: 'PLN', symbol: 'zł', name: 'Polish Zloty', region: 'eu' },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso', region: 'apac' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', region: 'apac' },
];

function getCurrencySymbol(code) {
  const cur = currencies.find((c) => c.code === String(code || '').toUpperCase());
  return cur ? cur.symbol : String(code || '').toUpperCase();
}

function isSupportedCurrency(code) {
  return currencies.some((c) => c.code === String(code || '').toUpperCase());
}

module.exports = { currencies, getCurrencySymbol, isSupportedCurrency };
