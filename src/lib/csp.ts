/**
 * Content-Security-Policy builder (audit M-3). Used by src/middleware.ts with a fresh
 * per-request nonce. script-src has no 'unsafe-inline': only scripts carrying the nonce
 * (Next.js framework/inline scripts get it automatically) and scripts they load
 * ('strict-dynamic') can run.
 */

type Env = Record<string, string | undefined>

/** Retired 1001 JSON-RPC used port 6005. Never allow it in connect-src. */
function isRetired1001RpcOrigin(origin: string): boolean {
  try {
    return new URL(origin).port === '6005'
  } catch {
    return /:6005(?:\/|$)/.test(origin)
  }
}

function originOf(u: string | undefined): string | null {
  if (!u) return null
  try {
    return new URL(u).origin
  } catch {
    return null
  }
}

export function buildCsp(nonce: string, env: Env): string {
  const isProd = env.VERCEL_ENV === 'production'
  const connect = new Set<string>(["'self'"])
  for (const u of ['https://ethereum-sepolia-rpc.publicnode.com', 'https://1rpc.io', 'https://sepolia.drpc.org']) connect.add(u)

  const arcade = new Set<string>(['https://falcon-arcade-lake.vercel.app'])
  if (!isProd) {
    for (const o of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173']) arcade.add(o)
  }
  for (const v of [env.NEXT_PUBLIC_ARCADE_URL, env.ARCADE_URL]) {
    const o = originOf(v)
    if (!o) continue
    if (isProd && (o.includes('localhost') || o.includes('127.0.0.1'))) continue
    arcade.add(o)
  }
  for (const o of arcade) connect.add(o)

  // Vercel Live toolbar only exists on preview deployments.
  const vercelLive = !isProd
  if (vercelLive) {
    connect.add('https://vercel.live')
    connect.add('wss://ws-us3.pusher.com')
  }
  for (const v of [env.FALCON_BRIDGE_RPC_URL, env.NEXT_PUBLIC_TESTNET_RPC_URL, env.NEXT_PUBLIC_MAINNET_RPC_URL]) {
    const o = originOf(v)
    if (o && !isRetired1001RpcOrigin(o)) connect.add(o)
  }

  const frame = ["'self'", ...(vercelLive ? ['https://vercel.live'] : []), ...arcade]
  const script = [`'nonce-${nonce}'`, "'strict-dynamic'", "'self'", "'wasm-unsafe-eval'", ...(vercelLive ? ['https://vercel.live'] : [])]
  if (env.NODE_ENV === 'development') script.push("'unsafe-eval'") // React dev tooling only

  return [
    "default-src 'self'",
    `frame-src ${frame.join(' ')}`,
    `script-src ${script.join(' ')}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    `font-src 'self' data:${vercelLive ? ' https://vercel.live' : ''}`,
    `connect-src ${[...connect].filter((o) => o === "'self'" || !isRetired1001RpcOrigin(o)).join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

export function newNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  let s = ''
  b.forEach((x) => (s += String.fromCharCode(x)))
  return btoa(s)
}
