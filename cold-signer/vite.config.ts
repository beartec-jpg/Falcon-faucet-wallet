import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

/**
 * Falcon Cold Signer — air-gapped PWA.
 * Served at /cold-signer/ on the portal host (or fully offline after install).
 */
export default defineConfig({
  base: '/cold-signer/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['wasm/falcon-512.min.js', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Falcon Cold Signer',
        short_name: 'Cold Signer',
        description: 'Air-gapped Falcon Ledger vault signing',
        theme_color: '#0e7490',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/cold-signer/',
        scope: '/cold-signer/',
        // Separate any / maskable icons — combined purpose can block installability
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache EVERYTHING needed offline — WASM, codec chunks, icons
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: '/cold-signer/index.html',
        runtimeCaching: [],
      },
      devOptions: { enabled: true },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
  server: {
    port: 3001,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
})
