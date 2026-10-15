import { permanentRedirect } from 'next/navigation'

/** Marketplace consolidated into /swap (USDC-only). */
export default function MarketplaceRedirect() {
  permanentRedirect('/swap')
}