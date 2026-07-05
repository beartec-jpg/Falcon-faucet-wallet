// Falcon Ledger Wallet — Service Worker
// Network-first for API + WASM; stale-while-revalidate for static assets

const CACHE = 'falcon-wallet-v3'

const PRECACHE_URLS = [
  '/',
  '/wallet',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  if (url.origin !== self.location.origin) return

  // API + Falcon WASM bundle: network-first
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/wasm/') || url.pathname.includes('.wasm')) {
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

  // App shell + static: stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return response
      })
      return cached || fetchPromise
    })
  )
})