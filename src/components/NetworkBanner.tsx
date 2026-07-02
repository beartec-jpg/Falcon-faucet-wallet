'use client'

import { useNetwork } from '@/components/NetworkProvider'

export default function NetworkBanner() {
  const { network } = useNetwork()

  if (network.live) {
    if (network.badge === 'testnet') {
      return (
        <div className="bg-amber-950/50 border-b border-amber-800/40 px-4 py-2 text-center text-xs text-amber-200/90">
          <span className="font-medium">{network.name}</span>
          {' · '}Network ID {network.networkId}
          {' · '}Test tokens — no real value
        </div>
      )
    }
    return (
      <div className="bg-emerald-950/50 border-b border-emerald-800/40 px-4 py-2 text-center text-xs text-emerald-200/90">
        <span className="font-medium">{network.name}</span>
        {' · '}Network ID {network.networkId}
        {' · '}Mainnet
      </div>
    )
  }

  return (
    <div className="bg-slate-900 border-b border-slate-700 px-4 py-2 text-center text-xs text-slate-400">
      <span className="font-medium text-slate-300">{network.name}</span>
      {' — '}
      {network.comingSoonMessage ?? 'Not live yet. Balances show on-chain state when RPC is configured.'}
    </div>
  )
}