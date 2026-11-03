// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { permanentRedirect } from 'next/navigation'

/** Marketplace consolidated into /swap (USDC-only). */
export default function MarketplaceRedirect() {
  permanentRedirect('/swap')
}