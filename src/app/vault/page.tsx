import WalletPlClient from '@/app/wallet/WalletPlClient'

export const dynamic = 'force-dynamic'

/** Destination-locked vault: nominate one address to activate. */
export default function VaultPage() {
  return <WalletPlClient mode="vault" />
}
