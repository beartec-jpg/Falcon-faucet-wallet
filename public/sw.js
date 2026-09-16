// Falcon Ledger Wallet — Service Worker
// Network-first for GET API + WASM; never intercept POST (Claim / submit).

const CACHE = 'falcon-wallet-v12'
const API_TIMEOUT_MS = 30_000

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

  // Mutations must hit the live Next process. A down :3040 is not "offline",
  // and a fake 503 here used to abort Claim FBTC with "You are offline".
  if (request.method !== 'GET' && request.method !== 'HEAD') return

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/wasm/') || url.pathname.includes('.wasm')) {
    event.respondWith(
      fetchWithTimeout(request, API_TIMEOUT_MS).catch(() =>
        new Response(
          JSON.stringify({
            error: 'Wallet server unreachable — retry. If you already sent BTC, do not re-send.',
            unreachable: true,
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    )
    return
  }

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
