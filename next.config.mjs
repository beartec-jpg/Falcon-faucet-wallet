/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep ripple sub-packages as native Node modules (not webpack-bundled).
  experimental: {
    serverComponentsExternalPackages: [
      'ripple-keypairs',
      'ripple-binary-codec',
      'ripple-address-codec',
      '@xrplf/isomorphic',
    ],
  },

  // Security headers (M-1 from wallet audit)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          // CSP tuned for Next.js + qXRP wallet (testnet). Tighten before any real-value use.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live", // Next.js dev + Vercel
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https: wss: http:", // Allow http for testnet nodes during transition
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
