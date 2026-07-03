import { redirect } from 'next/navigation'

/** Marketplace consolidated into /swap (USDC-only). */
export default function MarketplaceRedirect() {
  redirect('/swap')
}