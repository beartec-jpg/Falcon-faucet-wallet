// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/vault',
  'Vault',
  'Falcon PL vault for testnet FPL.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
