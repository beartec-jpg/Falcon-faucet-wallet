/**
 * Full-screen block when a vault is loaded AND the device is online.
 * First-time install / empty device is NOT blocked — only vault use.
 */

interface Props {
  onRetry?: () => void
  onInstall?: () => void
  canInstall?: boolean
  vaultLabel?: string
}

export default function OfflineWall({ onRetry, onInstall, canInstall, vaultLabel }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-slate-950 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-900/40 border border-amber-600/40 flex items-center justify-center text-3xl mb-4">
        📡
      </div>
      <h1 className="text-xl font-bold text-white mb-2">Go offline to use vault</h1>
      <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
        A vault{vaultLabel ? ` (${vaultLabel})` : ''} is loaded on this device. Unlocking and signing
        are blocked while online. Enable <strong className="text-slate-200">airplane mode</strong>{' '}
        (Wi‑Fi and mobile data off), then continue.
      </p>
      <ul className="text-left text-xs text-slate-500 mt-6 space-y-2 max-w-sm">
        <li>1. Turn on airplane mode</li>
        <li>2. Confirm the Offline badge</li>
        <li>3. Unlock vault and sign offline only</li>
      </ul>
      <div className="mt-8 flex flex-col gap-3 w-full max-w-xs">
        {canInstall && onInstall && (
          <button
            type="button"
            onClick={onInstall}
            className="px-5 py-3 rounded-2xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold"
          >
            Install to Home Screen
          </button>
        )}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-5 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold"
          >
            I&apos;m offline — continue
          </button>
        )}
      </div>
    </div>
  )
}
