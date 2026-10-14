import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 14 collect/prerender `require()`s server chunks. Leaving ESM-only
  // xrpl/noble packages external throws ERR_REQUIRE_ESM. Bundle them instead.
  experimental: {
    esmExternals: false,
  },
  serverExternalPackages: ['@openforge-sh/liboqs'],
  transpilePackages: [
    'xrpl',
    'ripple-binary-codec',
    '@xrplf/isomorphic',
    '@noble/hashes',
    '@noble/curves',
  ],

  webpack: (config, { isServer }) => {
    // ripple-address-codec pulls ESM-only @scure/base (ERR_REQUIRE_ESM on collect).
    // Alias to a CJS facade so ripple-keypairs `require(...).encodeSeed` is a function.
    config.resolve.alias = {
      ...config.resolve.alias,
      'ripple-address-codec': path.join(__dirname, 'src/lib/ripple-address-codec-shim.js'),
    }
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
    // Page CSP (with a per-request nonce) is set in src/middleware.ts (audit M-3).
    // Static HTML in /public is not served through middleware, so it gets a fixed policy
    // here: no 'unsafe-inline'; clear-spv.html's one inline script is allowed by hash.
    const clearSpv = fs.readFileSync(path.join(__dirname, 'public/clear-spv.html'), 'utf8')
    const inline = [...clearSpv.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`,
    )
    const staticCsp = (extraScript) =>
      [
        "default-src 'self'",
        `script-src 'self' 'wasm-unsafe-eval' ${extraScript}`.trim(),
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
      {
        // /cold-signer (no trailing slash) serves the same static index.html.
        source: '/cold-signer',
        headers: [{ key: 'Content-Security-Policy', value: staticCsp('') }],
      },
      {
        source: '/cold-signer/:path*',
        headers: [{ key: 'Content-Security-Policy', value: staticCsp('') }],
      },
      {
        source: '/clear-spv.html',
        headers: [{ key: 'Content-Security-Policy', value: staticCsp(inline.join(' ')) }],
      },
    ]
  },
}

export default nextConfig