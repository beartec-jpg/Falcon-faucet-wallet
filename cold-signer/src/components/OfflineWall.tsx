/**
 * Full-screen block when the device is online.
 * Ops (import / unlock / sign) are forbidden until airplane mode.
 * Install / Add to Home Screen is still allowed while online (one-time setup).
 */

interface Props {
  /** True during first-run install window — softer copy */
  installMode?: boolean
  onRetry?: () => void
  /** Browser install prompt (beforeinstallprompt) */
  onInstall?: () => void
  canInstall?: boolean
}

export default function OfflineWall({ installMode, onRetry, onInstall, canInstall }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-slate-950 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-900/40 border border-amber-600/40 flex items-center justify-center text-3xl mb-4">
        📡
      </div>
      <h1 className="text-xl font-bold text-white mb-2">Airplane mode required</h1>
      <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
        {installMode ? (
          <>
            You may stay online only long enough to <strong className="text-slate-200">install this app</strong> and
            let it cache offline. Then turn on airplane mode (Wi‑Fi and mobile data off) before importing your vault
            or signing.
          </>
        ) : (
          <>
            This cold signer refuses to run while the device is online. Turn on{' '}
            <strong className="text-slate-200">airplane mode</strong>, disable Wi‑Fi, then continue.
          </>
        )}
      </p>
      <ul className="text-left text-xs text-slate-500 mt-6 space-y-2 max-w-sm">
        <li>1. Install to Home Screen (if not already)</li>
        <li>2. Enable airplane mode</li>
        <li>3. Confirm the badge shows Offline</li>
        <li>4. Import vault JSON from SD / USB</li>
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
      <p className="mt-6 text-[11px] text-slate-600 max-w-sm">
        Alternate: copy the cold-signer package + vault JSON via USB/SD and never open this origin on the cold phone.
      </p>
    </div>
  )
}
