// Falcon Ledger Wallet — Service Worker
// Network-first for API + WASM; stale-while-revalidate for static assets

const CACHE = 'falcon-wallet-v10'
const API_TIMEOUT_MS = 10_000

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

function fetchWithTimeout(request, ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer))
}

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  if (url.origin !== self.location.origin) return

  // API + Falcon WASM bundle: network-first, bounded so explorer cannot spin forever
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/wasm/') || url.pathname.includes('.wasm')) {
    event.respondWith(
      fetchWithTimeout(request, API_TIMEOUT_MS).catch(() =>
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
