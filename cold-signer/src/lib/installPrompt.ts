/**
 * PWA install helpers.
 *
 * Captures beforeinstallprompt early (before React mounts) and waits for the
 * service worker — Chrome will not offer a real install until SW + icons +
 * manifest are valid.
 */

export type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: DeferredInstallPrompt | null = null
const listeners = new Set<(p: DeferredInstallPrompt | null) => void>()

function notify() {
  for (const fn of listeners) fn(deferred)
}

/** Call once from main.tsx before render. */
export function initInstallPromptCapture(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as DeferredInstallPrompt
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export function getDeferredInstallPrompt(): DeferredInstallPrompt | null {
  return deferred
}

export function subscribeInstallPrompt(
  fn: (p: DeferredInstallPrompt | null) => void,
): () => void {
  listeners.add(fn)
  fn(deferred)
  return () => {
    listeners.delete(fn)
  }
}

/** Ensure SW for /cold-signer/ is registered and active. */
export async function ensureColdServiceWorker(): Promise<{ ok: boolean; detail: string }> {
  if (!('serviceWorker' in navigator)) {
    return { ok: false, detail: 'Service workers not supported in this browser' }
  }
  try {
    // Prefer the built register path; re-register is idempotent
    const reg = await navigator.serviceWorker.register('/cold-signer/sw.js', {
      scope: '/cold-signer/',
    })
    await navigator.serviceWorker.ready
    // Give workbox a moment to claim + precache (helps installability)
    await new Promise((r) => setTimeout(r, 300))
    const active = reg.active || reg.waiting || reg.installing
    return {
      ok: !!active || !!navigator.serviceWorker.controller,
      detail: active ? `SW ${active.state}` : 'SW registered (waiting for controller)',
    }
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : 'Service worker registration failed',
    }
  }
}

/**
 * Wait until beforeinstallprompt fires or timeout.
 * Call after SW is ready — Chrome often fires the event then.
 */
export async function waitForInstallPrompt(timeoutMs = 4000): Promise<DeferredInstallPrompt | null> {
  if (deferred) return deferred
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      unsub()
      resolve(deferred)
    }, timeoutMs)
    const unsub = subscribeInstallPrompt((p) => {
      if (p) {
        clearTimeout(t)
        unsub()
        resolve(p)
      }
    })
  })
}

export type InstallResult =
  | { status: 'accepted' }
  | { status: 'dismissed' }
  | { status: 'unavailable'; reason: string }
  | { status: 'sw-failed'; reason: string }

/** Full install attempt: SW → wait for prompt → native installer. */
export async function promptInstall(): Promise<InstallResult> {
  const sw = await ensureColdServiceWorker()
  if (!sw.ok) {
    return { status: 'sw-failed', reason: sw.detail }
  }

  let p = deferred ?? (await waitForInstallPrompt(4500))
  if (!p) {
    return {
      status: 'unavailable',
      reason:
        'This browser did not offer an install dialog. Use Chrome/Edge on Android or desktop, or Safari Share → Add to Home Screen on iPhone.',
    }
  }

  try {
    await p.prompt()
    const { outcome } = await p.userChoice
    deferred = null
    notify()
    return outcome === 'accepted' ? { status: 'accepted' } : { status: 'dismissed' }
  } catch (e) {
    return {
      status: 'unavailable',
      reason: e instanceof Error ? e.message : 'Install prompt failed',
    }
  }
}
