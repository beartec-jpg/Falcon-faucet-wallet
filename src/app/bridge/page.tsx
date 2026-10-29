import { redirect } from 'next/navigation'

// BTC (testnet4) -> FBTC now lives in the wallet Bridge tab.
export default function BridgePage() {
  redirect('/wallet?section=bridge')
}
