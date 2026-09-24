/**
 * Map browser locale / language to a default currency automatically.
 */
const LOCALE_CURRENCY = {
  'en-us': 'USD', 'en-gb': 'GBP', 'en-ng': 'NGN', 'en-ke': 'KES', 'en-gh': 'GHS',
  'en-za': 'ZAR', 'en-in': 'INR', 'en-au': 'AUD', 'en-ca': 'CAD', 'en-sg': 'SGD',
  'en-ae': 'AED', 'en-ph': 'PHP',
  'fr-fr': 'EUR', 'fr-be': 'EUR', 'fr-ca': 'CAD', 'fr-ma': 'MAD',
  'es-es': 'EUR', 'es-mx': 'MXN', 'es-ar': 'USD', 'es-co': 'USD',
  'pt-br': 'BRL', 'pt-pt': 'EUR',
  'de-de': 'EUR', 'de-at': 'EUR', 'de-ch': 'CHF',
  'ar-sa': 'SAR', 'ar-ae': 'AED', 'ar-eg': 'EGP', 'ar-ma': 'MAD',
  'hi-in': 'INR',
  'sw-ke': 'KES', 'sw-tz': 'USD',
  en: 'USD', fr: 'EUR', es: 'EUR', pt: 'BRL', de: 'EUR', ar: 'AED', hi: 'INR', sw: 'KES',
}

const LANGUAGE_FROM_LOCALE = {
  en: 'en', es: 'es', fr: 'fr', pt: 'pt', de: 'de', ar: 'ar', hi: 'hi', sw: 'sw',
}

export function detectCurrency() {
  try {
    const stored = localStorage.getItem('preferredCurrency')
    if (stored) return stored.toUpperCase()
  } catch (_) {}

  if (typeof navigator === 'undefined') return 'USD'
  const loc = (navigator.language || 'en-US').toLowerCase()
  if (LOCALE_CURRENCY[loc]) return LOCALE_CURRENCY[loc]
  const lang = loc.split('-')[0]
  return LOCALE_CURRENCY[lang] || 'USD'
}

export function detectLanguage() {
  try {
    const stored = localStorage.getItem('i18nextLng')
    if (stored) return stored.slice(0, 2)
  } catch (_) {}
  if (typeof navigator === 'undefined') return 'en'
  const lang = (navigator.language || 'en').slice(0, 2).toLowerCase()
  return LANGUAGE_FROM_LOCALE[lang] || 'en'
}

export function setPreferredCurrency(code) {
  try {
    localStorage.setItem('preferredCurrency', String(code).toUpperCase())
  } catch (_) {}
}

export function getPreferredCurrency() {
  return detectCurrency()
}
