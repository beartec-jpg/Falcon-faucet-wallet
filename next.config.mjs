/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      'ripple-address-codec',
      '@openforge-sh/liboqs',
    ],
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.experiments = {
        ...config.experiments,
        asyncWebAssembly: true,
      }
      config.output = {
        ...config.output,
        environment: {
          ...config.output?.environment,
          asyncFunction: true,
        },
      }
    }
    return config
  },

  async headers() {
    // F-02: constrain connect-src to the specific origins the client actually
    // uses instead of a blanket `https:`/`wss:`, reducing the exfiltration
    // surface if a script injection ever occurs. Built at build time from the
    // known public endpoints plus any operator-configured RPC origins.
    const connectOrigins = new Set(["'self'"])
    // Public Sepolia RPC fallbacks used by the in-app EVM bridge client.
    for (const url of [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://1rpc.io',
      'https://sepolia.drpc.org',
    ]) connectOrigins.add(url)

    // Arcade iframe origin (Game Faucet host).
    // Production: no localhost in CSP. Preview/dev: allow local Vite.
    const isProdBuild = process.env.VERCEL_ENV === 'production'
    const arcadeOrigins = new Set(['https://falcon-arcade-lake.vercel.app'])
    if (!isProdBuild) {
      arcadeOrigins.add('http://localhost:5173')
      arcadeOrigins.add('http://127.0.0.1:5173')
      arcadeOrigins.add('http://localhost:4173')
      arcadeOrigins.add('http://127.0.0.1:4173')
    }
    for (const envVar of [
      process.env.NEXT_PUBLIC_ARCADE_URL,
      process.env.ARCADE_URL,
    ]) {
      if (!envVar) continue
      try {
        const o = new URL(envVar).origin
        if (
          isProdBuild &&
          (o.includes('localhost') || o.includes('127.0.0.1'))
        ) {
          continue
        }
        arcadeOrigins.add(o)
      } catch {
        /* ignore */
      }
    }
    for (const o of arcadeOrigins) connectOrigins.add(o)

    const frameSrc = ["'self'", 'https://vercel.live', ...arcadeOrigins].join(' ')
    // Vercel Live preview feedback (only active on preview deployments).
    connectOrigins.add('https://vercel.live')
    connectOrigins.add('wss://ws-us3.pusher.com')
    // Operator-configured RPC origins that the browser may connect to directly.
    for (const envVar of [
      process.env.FALCON_BRIDGE_RPC_URL,
      process.env.NEXT_PUBLIC_TESTNET_RPC_URL,
      process.env.NEXT_PUBLIC_MAINNET_RPC_URL,
    ]) {
      if (!envVar) continue
      try { connectOrigins.add(new URL(envVar).origin) } catch (err) {
        console.warn(`[csp] Ignoring malformed RPC URL in connect-src config: ${envVar}`, err)
      }
    }

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `frame-src ${frameSrc}`,
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://vercel.live",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              // vercel.live injects preview fonts; allow so the toolbar does not CSP-spam
              "font-src 'self' data: https://vercel.live",
              `connect-src ${Array.from(connectOrigins).join(' ')}`,
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig