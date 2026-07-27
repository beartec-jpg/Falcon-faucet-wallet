/**
 * Detect whether Cold Signer is running as an installed PWA (standalone),
 * not a normal browser tab. Vault import is only allowed when installed.
 */

export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false

  // Standard / Android Chrome / desktop Chromium
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true
  if (window.matchMedia('(display-mode: minimal-ui)').matches) return true

  // iOS Safari "Add to Home Screen"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = window.navigator as any
  if (nav.standalone === true) return true

  // Some Android WebViews set this
  if (document.referrer.startsWith('android-app://')) return true

  return false
}

/**
 * Dev-only: allow import in a normal browser tab.
 * localStorage.setItem('falcon-cold-allow-browser', '1')
 */
export function allowBrowserImportOverride(): boolean {
  try {
    return localStorage.getItem('falcon-cold-allow-browser') === '1'
  } catch {
    return false
  }
}

/** True when vault import is permitted. */
export function canImportVault(): boolean {
  return isStandalonePwa() || allowBrowserImportOverride()
}

export function assertInstalledPwa(): void {
  if (canImportVault()) return
  throw new Error(
    'Install Cold Signer as an app first (Add to Home Screen), then open it from the home screen to import your vault.',
  )
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
