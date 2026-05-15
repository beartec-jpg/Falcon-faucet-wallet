// qXRP Wallet — Service Worker
// Strategy: network-first for API routes, cache-first for static assets

const CACHE = 'qxrp-wallet-v1'

// Assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/wallet',
  '/manifest.json',
  '/favicon.svg',
]

// ── Install ───────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(() => { /* ignore fetch errors during install */ }))
      .then(() => self.skipWaiting())
  )
})

// ── Activate ──────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE).map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return

  // API routes: network-first, offline fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'You are offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    return
  }

  // Static assets: cache-first with background network update
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return response
      })
      return cached || networkFetch
    })
  )
})
