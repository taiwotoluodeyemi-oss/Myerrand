import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { detectCurrency, setPreferredCurrency } from '../utils/localeCurrency'

const OPTIONS = [
  'USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR', 'INR', 'AED', 'CAD', 'AUD', 'BRL', 'MXN', 'JPY', 'CNY', 'SGD',
]

export default function CurrencySwitcher() {
  const { t } = useTranslation()
  const [currency, setCurrency] = useState('USD')

  useEffect(() => {
    setCurrency(detectCurrency())
  }, [])

  const onChange = (e) => {
    const v = e.target.value
    setCurrency(v)
    setPreferredCurrency(v)
    // Notify app (App.jsx / wallet can listen)
    window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: v } }))
  }

  return (
    <label className="currency-switcher" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span>{t('currency')}</span>
      <select value={currency} onChange={onChange} aria-label={t('currency')}>
        {OPTIONS.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </label>
  )
}
