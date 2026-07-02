'use client'

import { useNetwork } from '@/components/NetworkProvider'
import { getNetwork, type NetworkKey } from '@/lib/networks'

const OPTIONS: { key: NetworkKey; label: string }[] = [
  { key: 'testnet', label: 'Testnet' },
  { key: 'mainnet', label: 'Mainnet' },
]

export default function NetworkSwitcher({ compact = false }: { compact?: boolean }) {
  const { networkKey, network, setNetworkKey } = useNetwork()

  return (
    <div
      className={`flex items-center gap-2 ${compact ? '' : 'flex-wrap'}`}
      role="group"
      aria-label="Select network"
    >
      <div className="inline-flex rounded-lg border border-slate-700/80 bg-slate-900/80 p-0.5">
        {OPTIONS.map(({ key, label }) => {
          const active = networkKey === key
          const cfg = key === 'testnet' ? 'testnet' : 'mainnet'
          const mainnetLive = getNetwork('mainnet').live
          return (
            <button
              key={key}
              type="button"
              onClick={() => setNetworkKey(key)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                active
                  ? cfg === 'mainnet'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-amber-600/90 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              aria-pressed={active}
              title={
                key === 'mainnet' && !mainnetLive
                  ? 'Mainnet not live yet — preview balances and UI'
                  : undefined
              }
            >
              {label}
              {key === 'mainnet' && !mainnetLive && (
                <span className="ml-1 opacity-70">· soon</span>
              )}
            </button>
          )
        })}
      </div>
      {!compact && (
        <span
          className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
            network.badge === 'mainnet'
              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
              : 'bg-amber-950/80 text-amber-400/90 border border-amber-800/40'
          }`}
        >
          ID {network.networkId}
        </span>
      )}
    </div>
  )
}