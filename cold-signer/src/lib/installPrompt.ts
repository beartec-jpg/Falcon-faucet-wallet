/**
 * Capture beforeinstallprompt as early as possible (before React mounts).
 * If we only listen in useEffect, the browser event can fire first and be lost —
 * then the UI falls back to "save page / menu" instructions with no Install button.
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

/** Trigger native install UI when available. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const p = deferred
  if (!p) return 'unavailable'
  try {
    await p.prompt()
    const { outcome } = await p.userChoice
    deferred = null
    notify()
    return outcome
  } catch {
    return 'unavailable'
  }
}
