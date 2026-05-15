/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep ripple sub-packages as native Node modules (not webpack-bundled).
  // Next.js 14.x uses experimental.serverComponentsExternalPackages;
  // Next.js 15+ uses serverExternalPackages at the top level.
  experimental: {
    serverComponentsExternalPackages: [
      'ripple-keypairs',
      'ripple-binary-codec',
      'ripple-address-codec',
      '@xrplf/isomorphic',
    ],
  },
}

export default nextConfig
