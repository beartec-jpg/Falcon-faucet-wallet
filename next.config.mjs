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
          // Basic CSP - tighten further before mainnet
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js requires some inline/eval
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https: http:", // Allow both for testnet flexibility
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
