/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep ripple sub-packages as native Node modules (not webpack-bundled).
  // The full xrpl package is no longer imported server-side.
  serverExternalPackages: [
    'ripple-keypairs',
    'ripple-binary-codec',
    'ripple-address-codec',
    '@xrplf/isomorphic',
  ],
}

export default nextConfig
