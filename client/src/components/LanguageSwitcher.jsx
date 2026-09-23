import React from 'react'
import { useTranslation } from 'react-i18next'

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'sw', label: 'Kiswahili' },
]

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  return (
    <label className="language-switcher" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span>{t('language')}</span>
      <select
        value={(i18n.language || 'en').slice(0, 2)}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
        aria-label={t('language')}
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
    </label>
  )
}
