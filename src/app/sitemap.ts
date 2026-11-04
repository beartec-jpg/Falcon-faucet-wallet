// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo'

const ROUTES: [string, number][] = [
  ['/', 1],
  ['/whitepaper', 0.9],
  ['/validator', 0.9],
  ['/airdrop', 0.9],
  ['/faucet', 0.8],
  ['/wallet', 0.8],
  ['/scan', 0.8],
  ['/scan/methodology', 0.7],
  ['/scan/map', 0.6],
  ['/first-35', 0.7],
  ['/validator/apply', 0.6],
  ['/arcade', 0.6],
  ['/arcade/leaderboard', 0.5],
  ['/swap', 0.6],
  ['/pool', 0.6],
  ['/lend', 0.6],
  ['/community', 0.6],
  ['/rewards', 0.4],
  ['/vault', 0.4],
  ['/community/faq', 0.8],
  ['/terms', 0.3],
  ['/terms-of-use', 0.3],
  ['/privacy', 0.3],
  ['/feedback', 0.5],
  ['/community/learn', 0.7],
  ['/community/learn/post-quantum-blockchain', 0.8],
  ['/community/validators/run-a-node', 0.8],
  ['/testnet-faucet', 0.7],
  ['/developers', 0.6],
  ['/developers/gateway', 0.5],
  ['/developers/explorer-api', 0.5],
  ['/developers/pricing', 0.5],
  ['/developers/api-keys', 0.3],
  ['/developers/sdk', 0.4],
]

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return ROUTES.map(([path, priority]) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
    lastModified,
    changeFrequency: 'weekly',
    priority,
  }))
}
