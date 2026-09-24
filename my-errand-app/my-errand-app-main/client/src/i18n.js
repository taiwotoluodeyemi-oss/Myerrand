import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en/translation.json'
import es from './locales/es/translation.json'
import fr from './locales/fr/translation.json'
import pt from './locales/pt/translation.json'
import de from './locales/de/translation.json'
import ar from './locales/ar/translation.json'
import hi from './locales/hi/translation.json'
import sw from './locales/sw/translation.json'

const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  pt: { translation: pt },
  de: { translation: de },
  ar: { translation: ar },
  hi: { translation: hi },
  sw: { translation: sw },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'fr', 'pt', 'de', 'ar', 'hi', 'sw'],
    debug: process.env.NODE_ENV === 'development',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },
  })

// Basic RTL support for Arabic
if (typeof document !== 'undefined') {
  const applyDir = (lng) => {
    document.documentElement.lang = lng || 'en'
    document.documentElement.dir = lng === 'ar' ? 'rtl' : 'ltr'
  }
  applyDir(i18n.language)
  i18n.on('languageChanged', applyDir)
}

export default i18n
