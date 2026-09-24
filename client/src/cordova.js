export const isCordova = () => typeof window !== 'undefined' && Boolean(window.cordova)

export const waitForCordova = (onReady) => {
  if (!isCordova()) {
    onReady()
    return () => {}
  }

  const handleReady = () => {
    if (window.StatusBar) {
      window.StatusBar.backgroundColorByHexString('#1f6feb')
    }
    onReady()
  }

  document.addEventListener('deviceready', handleReady, { once: true })
  return () => document.removeEventListener('deviceready', handleReady)
}

export const emitPageLifecycle = (pageName) => {
  const page = document.getElementById('root')
  if (!page) return () => {}

  page.dataset.page = pageName.replace(/^\//, '') || 'home'
  page.dispatchEvent(new CustomEvent('appShow', { detail: { page: pageName } }))

  const frame = window.requestAnimationFrame(() => {
    page.dispatchEvent(new CustomEvent('appReady', { detail: { page: pageName } }))
  })

  return () => {
    window.cancelAnimationFrame(frame)
    page.dispatchEvent(new CustomEvent('appHide', { detail: { page: pageName } }))
  }
}

export const registerBackLifecycle = () => {
  const page = document.getElementById('root')
  if (!page || !isCordova()) return () => {}

  const handleBack = () => {
    page.dispatchEvent(new CustomEvent('appBack'))
  }

  document.addEventListener('backbutton', handleBack, false)
  return () => document.removeEventListener('backbutton', handleBack, false)
}