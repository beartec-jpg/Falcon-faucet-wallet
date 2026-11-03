import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Wallet compat tests import the wallet's own signing code from ../../src/lib.
// Resolve its deps from this package so the wallet's node_modules isn't needed.
const here = path.dirname(new URL(import.meta.url).pathname)
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/lib\/(.*)$/, replacement: path.resolve(here, '../../src/lib/$1') },
      { find: /^@noble\/hashes\/(.*)$/, replacement: path.resolve(here, 'node_modules/@noble/hashes/$1') },
    ],
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 60_000 },
})
