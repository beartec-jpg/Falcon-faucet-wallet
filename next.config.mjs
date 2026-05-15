/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent webpack from bundling xrpl and its deps — they must run as
  // native Node.js modules in Vercel's serverless environment.
  serverExternalPackages: [
    'xrpl',
    'ripple-keypairs',
    'ripple-binary-codec',
    'ripple-address-codec',
    '@xrplf/isomorphic',
  ],
}

export default nextConfig
