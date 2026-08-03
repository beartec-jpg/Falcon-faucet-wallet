'use client'

import { tokenChipClass, shortTokenLabel } from '@/lib/wallet-ui'

export type PickerOption = {
  id: string
  symbol: string
  subtitle: string
  balanceLabel: string
  /** For send: only show if true. Receive shows all. */
  canSend: boolean
  balance: number
}

export default function WalletAssetPicker({
  mode,
  title,
  options,
  onPick,
  onClose,
}: {
  mode: 'send' | 'receive'
  title: string
  options: PickerOption[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  const list =
    mode === 'send' ? options.filter((o) => o.canSend && o.balance > 0) : options

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="asset-picker-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="asset-picker-title" className="text-base font-semibold text-white">
              {title}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {mode === 'send'
                ? 'Choose an asset with a balance to send.'
                : 'Choose a native chain to show its deposit address.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {list.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">
            {mode === 'send' ? 'No assets with a balance to send.' : 'No assets available.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {list.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => onPick(o.id)}
                className="flex flex-col items-start gap-2 rounded-xl border border-slate-700/90 bg-slate-800/50 p-3 text-left hover:border-brand-500/40 hover:bg-slate-800 transition-all active:scale-[0.98]"
              >
                <span className={`wallet-chip ${tokenChipClass(o.id)}`}>{shortTokenLabel(o.id)}</span>
                <span className="text-sm font-semibold text-white">{o.symbol}</span>
                <span className="text-[10px] text-slate-500 leading-snug line-clamp-2">{o.subtitle}</span>
                <span className="font-mono text-xs text-slate-300 tabular-nums mt-auto pt-1">
                  {mode === 'send' ? o.balanceLabel : o.balanceLabel === '—' ? ' ' : o.balanceLabel}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
