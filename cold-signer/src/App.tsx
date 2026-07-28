import { useCallback, useEffect, useState } from 'react'
import { AnimatedQr, MultiQrScan } from './components/MultiQr'
import {
  assertOfflineForVaultOps,
  allowOnlineOverride,
  readOnlineState,
} from './lib/offlineGate'
import {
  assertInstalledPwa,
  canImportVault,
  isIos,
  isStandalonePwa,
} from './lib/pwaDetect'
import {
  getDeferredInstallPrompt,
  promptInstall,
  subscribeInstallPrompt,
} from './lib/installPrompt'
import {
  hasColdVault,
  loadColdVaultMeta,
  saveColdVaultWithPassword,
  saveColdVaultWithPasskey,
  unlockColdVaultWithPassword,
  unlockColdVaultWithPasskey,
  updateLastAccount,
  wipeColdVault,
} from './lib/coldVaultDb'
import {
  authenticateColdPasskey,
  isPasskeySupported,
  registerColdPasskey,
} from './lib/coldPasskey'
import {
  decryptVaultFile,
  parseVaultFile,
  validateVaultPassphrase,
} from '@/lib/vault-export'
import {
  buildUnlockMessage,
  encodeUnlockResponse,
  encodeSignedTx,
  parseUnlockChallenge,
  parseUnsignedPayment,
  parsePastedTransport,
} from '@/lib/vault-protocol'
import { encodeMultiQr, type EncodedMultiQr, b64uEncode } from '@/lib/multi-qr'
import { signTxJson } from '@/lib/falcon-tx-sign'
import { decodeFalconSecret, zeroize } from '@/lib/falcon-keys'
import { getFalcon512 } from '@/lib/falcon-wasm'

type Step =
  | 'boot'
  | 'empty' // no vault yet — online OK (install + import)
  | 'import'
  | 'locked'
  | 'actions' // unlocked: action list
  | 'unlock-scan-chal'
  | 'unlock-camera'
  | 'unlock-show-resp'
  | 'sign-scan'
  | 'sign-camera'
  | 'sign-preview'
  | 'sign-show'

interface SessionKeys {
  falcon_secret: string
  address: string
  publicKey: string
  label: string
}

export default function App() {
  const [online, setOnline] = useState(() => readOnlineState().online)
  const [step, setStep] = useState<Step>('boot')
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof loadColdVaultMeta>>>(null)
  const [session, setSession] = useState<SessionKeys | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Import form
  const [fileText, setFileText] = useState<string | null>(null)
  const [vaultPaste, setVaultPaste] = useState('')
  const [payloadPaste, setPayloadPaste] = useState('')
  const [vaultPass, setVaultPass] = useState('')
  const [coldPass, setColdPass] = useState('')
  const [coldPass2, setColdPass2] = useState('')
  /**
   * Protect secret on this cold device after import.
   * Default password — Android credential manager often fails on passkey create
   * ("unknown error while talking to the credential manager").
   */
  const [importMethod, setImportMethod] = useState<'password' | 'passkey'>('password')

  // Unlock / sign QR
  const [respEnc, setRespEnc] = useState<EncodedMultiQr | null>(null)
  const [preview, setPreview] = useState<ReturnType<typeof parseUnsignedPayment> | null>(null)
  const [signedEnc, setSignedEnc] = useState<EncodedMultiQr | null>(null)

  const [canNativeInstall, setCanNativeInstall] = useState(
    () => !!getDeferredInstallPrompt(),
  )
  const [installed, setInstalled] = useState(() => isStandalonePwa())
  const [installBusy, setInstallBusy] = useState(false)
  const [showInstallHelp, setShowInstallHelp] = useState(false)

  const refreshOnline = useCallback(() => {
    setOnline(readOnlineState().online)
  }, [])

  const refreshInstalled = useCallback(() => {
    setInstalled(isStandalonePwa())
  }, [])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => {
    const unsub = subscribeInstallPrompt((p) => setCanNativeInstall(!!p))
    const onVis = () => refreshInstalled()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('appinstalled', () => {
      setInstalled(true)
      setCanNativeInstall(false)
      setShowInstallHelp(false)
    })
    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refreshInstalled])

  async function handleInstallClick() {
    setError('')
    setInstallBusy(true)
    setShowInstallHelp(false)
    try {
      const result = await promptInstall()
      if (result.status === 'accepted') {
        setInstalled(true)
        setShowInstallHelp(false)
        setError(
          'Installed. Close this tab and open “Cold Signer” from your home screen / app list, then continue.',
        )
        return
      }
      if (result.status === 'dismissed') {
        setError('Install was cancelled. Tap Install app again when ready.')
        return
      }
      if (result.status === 'sw-failed') {
        setShowInstallHelp(true)
        setError(`Could not finish app setup: ${result.reason}`)
        return
      }
      // unavailable — native dialog never offered
      setShowInstallHelp(true)
      setError(result.reason)
    } finally {
      setInstallBusy(false)
      setTimeout(refreshInstalled, 400)
    }
  }

  useEffect(() => {
    ;(async () => {
      const has = await hasColdVault()
      const m = has ? await loadColdVaultMeta() : null
      setMeta(m)
      // No vault → always show empty/import (online OK for install + first load).
      // Vault present → locked when offline; wall when online (handled below).
      setStep(has ? 'locked' : 'empty')
    })().catch((e) => {
      setError(e instanceof Error ? e.message : 'Boot failed')
      setStep('empty')
    })
  }, [])

  // Going online mid-session: keep device unlock for read-only balance, but clear
  // in-progress sign state. Signing still asserts offline.
  useEffect(() => {
    if (!meta) return
    if (online && !allowOnlineOverride()) {
      setPreview(null)
      setSignedEnc(null)
      setRespEnc(null)
      if (
        step === 'sign-preview' ||
        step === 'sign-show' ||
        step === 'sign-scan' ||
        step === 'sign-camera' ||
        step === 'unlock-scan-chal' ||
        step === 'unlock-camera' ||
        step === 'unlock-show-resp'
      ) {
        setStep(session ? 'actions' : 'locked')
      }
    }
  }, [online, meta, session, step])

  const hasVault = !!meta

  // ── Import vault file ───────────────────────────────────────────────────────
  // Only from the installed PWA (not a browser tab). Online OK until vault loads.

  async function handleImport() {
    setError('')
    try {
      assertInstalledPwa()
      if (!fileText) throw new Error('Choose a vault JSON file')
      const passErr = validateVaultPassphrase(vaultPass)
      if (passErr) throw new Error(passErr)
      setBusy(true)
      const file = parseVaultFile(JSON.parse(fileText))
      const inner = await decryptVaultFile(file, vaultPass)
      const metaBase = {
        address: inner.address,
        publicKey: inner.publicKey,
        label: inner.label,
        createdAt: inner.createdAt,
      }

      if (importMethod === 'passkey') {
        if (!isPasskeySupported()) {
          throw new Error('Passkeys not supported on this device. Switch to Password and import again.')
        }
        try {
          const reg = await registerColdPasskey(inner.label || 'Falcon Cold Vault')
          await saveColdVaultWithPasskey(
            metaBase,
            inner.falcon_secret,
            reg.credentialId,
            reg.keyBytes,
            reg.hasPrf,
          )
          setMeta({
            id: 'main',
            ...metaBase,
            unlockMethod: 'passkey',
            credentialId: reg.credentialId,
            hasPrf: reg.hasPrf,
          })
        } catch (pkErr) {
          // Keep vault file loaded; user can switch to password without re-picking file
          setImportMethod('password')
          throw pkErr
        }
      } else {
        if (coldPass.length < 12) throw new Error('Cold unlock password must be ≥ 12 characters')
        if (coldPass !== coldPass2) throw new Error('Cold passwords do not match')
        await saveColdVaultWithPassword(metaBase, inner.falcon_secret, coldPass)
        setMeta({
          id: 'main',
          ...metaBase,
          unlockMethod: 'password',
        })
      }

      setFileText(null)
      setVaultPass('')
      setColdPass('')
      setColdPass2('')
      // After import, require offline before unlock if still online
      setStep('locked')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Unlock cold device ──────────────────────────────────────────────────────

  async function handleUnlockDevice() {
    setError('')
    try {
      // Device unlock is read-only (balance view). Signing still requires offline.
      setBusy(true)
      const keys = await unlockColdVaultWithPassword(coldPass)
      setColdPass('')
      setSession(keys)
      const m = await loadColdVaultMeta()
      setMeta(m)
      setStep('actions')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unlock failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleUnlockPasskey() {
    setError('')
    try {
      if (!meta?.credentialId) throw new Error('No passkey registered for this vault')
      setBusy(true)
      const auth = await authenticateColdPasskey(meta.credentialId, !!meta.hasPrf)
      const keys = await unlockColdVaultWithPasskey(auth.keyBytes)
      setSession(keys)
      const m = await loadColdVaultMeta()
      setMeta(m)
      setStep('actions')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Passkey unlock failed')
    } finally {
      setBusy(false)
    }
  }

  function lockDevice() {
    setSession(null)
    setStep('locked')
    setPreview(null)
    setSignedEnc(null)
    setRespEnc(null)
  }

  // ── Unlock vault (hot portal challenge) ─────────────────────────────────────

  async function onUnlockChallenge(payload: string) {
    setError('')
    try {
      assertOfflineForVaultOps(true)
      if (!session) throw new Error('Unlock cold device first')
      const chal = parseUnlockChallenge(payload)
      if (chal.address !== session.address) {
        throw new Error('Challenge address does not match this vault')
      }
      if (Date.now() > chal.expiresAt) throw new Error('Challenge expired — regenerate on hot')
      // Cache live balance from hot (updates every vault unlock)
      if (chal.account) {
        await updateLastAccount({
          balance: chal.account.balance,
          exists: chal.account.exists,
          sequence: chal.account.sequence,
          currentLedger: chal.account.currentLedger,
          fetchedAt: chal.account.fetchedAt,
          networkKey: chal.account.networkKey,
        })
        setMeta(await loadColdVaultMeta())
      }
      const msg = buildUnlockMessage({
        address: chal.address,
        challenge: chal.challenge,
        expiresAt: chal.expiresAt,
      })
      const decoded = decodeFalconSecret(session.falcon_secret)
      try {
        const falcon = await getFalcon512()
        const sig = falcon.sign(msg, decoded.secretKey)
        const enc = encodeMultiQr(
          encodeUnlockResponse({
            type: 'vault-unlock-resp',
            v: 1,
            address: chal.address,
            challenge: chal.challenge,
            expiresAt: chal.expiresAt,
            sig: b64uEncode(sig),
          }),
          'vault-unlock-resp',
        )
        setRespEnc(enc)
        setStep('unlock-show-resp')
      } finally {
        zeroize(decoded.secretKey)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unlock sign failed')
      setStep('actions')
    }
  }

  // ── Sign payment ────────────────────────────────────────────────────────────

  function onUnsignedPayload(payload: string) {
    setError('')
    try {
      assertOfflineForVaultOps(true)
      const pkg = parseUnsignedPayment(payload)
      if (session && pkg.display.account !== session.address) {
        throw new Error('Transaction account does not match this vault')
      }
      setPreview(pkg)
      setStep('sign-preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid unsigned tx')
      setStep('actions')
    }
  }

  async function confirmSign() {
    if (!session || !preview) return
    setError('')
    setBusy(true)
    try {
      assertOfflineForVaultOps(true)
      const tx_blob = await signTxJson(preview.tx_json, session.falcon_secret)
      setSignedEnc(
        encodeMultiQr(
          encodeSignedTx({ type: 'falcon-signed-tx', v: 1, tx_blob }),
          'signed-tx',
        ),
      )
      setStep('sign-show')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signing failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleWipe() {
    if (!confirm('Wipe vault from this cold device? Recovery only via offline vault JSON.')) return
    await wipeColdVault()
    setSession(null)
    setMeta(null)
    setStep('empty')
  }

  // ── UI shells ───────────────────────────────────────────────────────────────

  const header = (
    <header className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-cyan-400 text-lg">❄</span>
        <span className="text-sm font-semibold text-white">Falcon Cold Signer</span>
      </div>
      <span
        className={`text-[11px] px-2 py-0.5 rounded-full ${
          online
            ? 'bg-amber-900/40 text-amber-300'
            : 'bg-emerald-900/40 text-emerald-300'
        }`}
      >
        {online ? 'Online · read-only' : 'Offline'}
      </span>
    </header>
  )

  const onlineBanner = online && hasVault && (
    <div className="mx-4 mt-3 text-[11px] text-amber-200/90 bg-amber-950/40 border border-amber-700/30 rounded-xl px-3 py-2">
      Online: view last known balance only. Go offline (airplane mode) before Unlock vault / Sign.
    </div>
  )

  const balanceCard = meta?.lastAccount && (
    <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-4 py-3">
      <p className="text-[11px] text-slate-500">Last known balance</p>
      <p className="text-2xl font-bold text-white">
        {meta.lastAccount.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}{' '}
        <span className="text-sm font-medium text-slate-400">FALCON</span>
      </p>
      <p className="text-[10px] text-slate-600 mt-1">
        {meta.lastAccount.exists ? 'Funded' : 'Unfunded'} · seq {meta.lastAccount.sequence}
        {meta.lastAccount.fetchedAt
          ? ` · ${new Date(meta.lastAccount.fetchedAt).toLocaleString()}`
          : ''}
      </p>
      <p className="text-[10px] text-slate-600">
        Refreshes when you complete Unlock vault with hot (includes live chain data).
      </p>
    </div>
  )

  if (step === 'boot') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 text-sm">
        Loading…
      </div>
    )
  }

  // Empty — install first (browser tab), then import only from installed PWA
  if (step === 'empty' || step === 'import') {
    const pwaReady = canImportVault() || installed

    // ── Step 1: Install PWA (first thing without a vault) ────────────────────
    if (!pwaReady) {
      return (
        <div className="min-h-screen flex flex-col bg-slate-950">
          {header}
          <main className="flex-1 max-w-md mx-auto w-full px-4 py-10 flex flex-col items-center text-center gap-5">
            <div className="w-20 h-20 rounded-full bg-cyan-950/60 border border-cyan-600/40 flex items-center justify-center text-4xl">
              ❄
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Install Cold Signer</h1>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed max-w-sm">
                Install this as an app first. Vault import only works from the installed app — not a
                browser tab.
              </p>
            </div>

            {error && (
              <div className="w-full text-sm text-amber-200 bg-amber-950/40 border border-amber-700/40 rounded-xl p-3 text-left">
                {error}
              </div>
            )}

            {/* Always a real Install button — triggers native prompt when Chrome/Edge allows it */}
            <button
              type="button"
              disabled={installBusy}
              onClick={() => void handleInstallClick()}
              className="w-full py-4 rounded-2xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white font-bold text-lg shadow-lg shadow-cyan-900/40"
            >
              {installBusy ? 'Preparing install…' : 'Install app'}
            </button>
            <p className="text-[11px] text-slate-500 -mt-2">
              {canNativeInstall
                ? 'Install dialog ready — tap Install app'
                : 'Tap Install app (sets up offline package, then browser install dialog)'}
            </p>

            {showInstallHelp && (
              <div className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 p-4 text-left space-y-2 text-xs text-slate-400">
                {isIos() ? (
                  <>
                    <p className="font-semibold text-slate-200">iPhone / iPad (Safari)</p>
                    <p>
                      Apple does not allow a one-tap install from the page. Use Share →{' '}
                      <strong className="text-slate-200">Add to Home Screen</strong>, then open the
                      Cold Signer icon.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-slate-200">If the install dialog did not open</p>
                    <p>
                      Look for the install icon in the address bar, or browser menu →{' '}
                      <strong className="text-slate-200">Install app</strong>. Then open Cold Signer
                      from your apps / home screen.
                    </p>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                refreshInstalled()
                if (!canImportVault()) {
                  setError(
                    'Open Cold Signer from the home screen / app icon after installing — not this browser tab.',
                  )
                } else {
                  setError('')
                }
              }}
              className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-semibold"
            >
              Opened from home screen — continue
            </button>

            <p className="text-[11px] text-slate-600 leading-relaxed max-w-sm">
              After install you can import your vault. Unlock and sign need airplane mode once a vault
              is loaded.
            </p>
          </main>
        </div>
      )
    }

    // ── Step 2: Import (only when running as installed PWA) ──────────────────
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 space-y-4">
          <div className="rounded-xl border border-emerald-700/30 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-300/90">
            Running as installed app — you can import a vault.
          </div>
          <h1 className="text-xl font-bold text-white">Import vault</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            Load the encrypted vault JSON. After import, enable airplane mode before unlocking or
            signing.
          </p>
          {online && (
            <div className="text-xs text-amber-300/90 bg-amber-950/30 border border-amber-700/30 rounded-xl p-3">
              Online is OK for import. Go offline before unlock / sign.
            </div>
          )}
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-800/40 rounded-xl p-3">
              {error}
            </div>
          )}
          <div className="rounded-2xl border border-cyan-600/40 bg-cyan-950/20 p-4 space-y-2">
            <p className="text-sm font-semibold text-cyan-200">Paste vault JSON</p>
            <p className="text-[11px] text-slate-400">
              One-device test: open the downloaded vault file in a text editor, copy all, paste here.
            </p>
            <textarea
              rows={6}
              value={vaultPaste}
              placeholder='{"type":"falcon-vault-export","version":1,...}'
              className="w-full rounded-xl bg-slate-950 border border-slate-600 px-3 py-2 text-[11px] font-mono text-slate-100"
              onChange={(e) => {
                setVaultPaste(e.target.value)
                const v = e.target.value.trim()
                setFileText(v || null)
              }}
            />
            {fileText && (
              <p className="text-[11px] text-emerald-400">Loaded {fileText.length} characters</p>
            )}
          </div>
          <label className="block text-xs text-slate-500">
            Or pick vault file from disk
            <input
              type="file"
              accept="application/json,.json,text/plain"
              className="mt-1 block w-full text-sm text-slate-300"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                const t = await f.text()
                setFileText(t)
                setVaultPaste(t)
              }}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Vault file password (from hot create)
            <input
              type="password"
              value={vaultPass}
              onChange={(e) => setVaultPass(e.target.value)}
              className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
            />
          </label>
          <div className="space-y-2">
            <p className="text-xs text-slate-400">Protect secret on this device with</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setImportMethod('password')}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border ${
                  importMethod === 'password'
                    ? 'border-cyan-500 bg-cyan-950/50 text-cyan-200'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                Password (recommended)
              </button>
              {isPasskeySupported() && (
                <button
                  type="button"
                  onClick={() => setImportMethod('passkey')}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border ${
                    importMethod === 'passkey'
                      ? 'border-cyan-500 bg-cyan-950/50 text-cyan-200'
                      : 'border-slate-700 bg-slate-900 text-slate-400'
                  }`}
                >
                  Passkey
                </button>
              )}
            </div>
            {importMethod === 'passkey' && (
              <p className="text-[11px] text-amber-400/90">
                Passkey can fail on some phones (credential manager). If import errors, use Password.
              </p>
            )}
          </div>
          {importMethod === 'password' && (
            <>
              <label className="block text-xs text-slate-400">
                New cold unlock password (this device)
                <input
                  type="password"
                  value={coldPass}
                  onChange={(e) => setColdPass(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-slate-400">
                Confirm cold password
                <input
                  type="password"
                  value={coldPass2}
                  onChange={(e) => setColdPass2(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
                />
              </label>
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleImport()}
            className="w-full py-3.5 rounded-2xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold"
          >
            {busy ? 'Importing…' : importMethod === 'passkey' ? 'Import with passkey' : 'Import vault'}
          </button>
        </main>
      </div>
    )
  }

  // Locked
  if (step === 'locked') {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        {onlineBanner}
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-10 space-y-6">
          <div className="text-center">
            <div className="text-4xl mb-3">🔒</div>
            <h1 className="text-xl font-bold text-white">{meta?.label ?? 'Vault'}</h1>
            <p className="text-[11px] font-mono text-slate-500 break-all mt-2 px-4">
              {meta?.address}
            </p>
          </div>
          {meta?.lastAccount && (
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 px-4 py-3 text-center">
              <p className="text-[11px] text-slate-500">Last known (unlock device to view)</p>
              <p className="text-lg font-semibold text-slate-300">
                {meta.lastAccount.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} FALCON
              </p>
            </div>
          )}
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-800/40 rounded-xl p-3">
              {error}
            </div>
          )}
          {meta?.unlockMethod === 'passkey' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleUnlockPasskey()}
              className="w-full py-4 rounded-2xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-lg"
            >
              {busy ? '…' : 'Unlock with passkey'}
            </button>
          ) : (
            <>
              <label className="block text-xs text-slate-400">
                Cold password
                <input
                  type="password"
                  value={coldPass}
                  onChange={(e) => setColdPass(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-3 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleUnlockDevice()}
                className="w-full py-4 rounded-2xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-lg"
              >
                Unlock
              </button>
            </>
          )}
          <button type="button" onClick={() => void handleWipe()} className="w-full text-[11px] text-slate-600">
            Wipe this device
          </button>
        </main>
      </div>
    )
  }

  // Action list — device unlocked (password/passkey): read-only balance + sign actions
  if (step === 'actions' && session) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        {onlineBanner}
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 space-y-3">
          <p className="text-xs text-slate-500 font-mono break-all">{session.address}</p>
          {balanceCard}
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-800/40 rounded-xl p-3">
              {error}
            </div>
          )}
          <p className="text-[11px] text-slate-500 pt-2">
            Read-only until you complete vault unlock with hot. Signing requires airplane mode.
          </p>
          <button
            type="button"
            onClick={() => setStep('unlock-scan-chal')}
            className="w-full text-left px-4 py-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-cyan-600/50"
          >
            <div className="font-semibold text-white">1. Unlock vault (hot challenge)</div>
            <div className="text-xs text-slate-400 mt-1">
              Scan or paste challenge from hot → returns live balance + response for portal
            </div>
          </button>
          <button
            type="button"
            onClick={() => setStep('sign-scan')}
            className="w-full text-left px-4 py-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-brand-500/40"
          >
            <div className="font-semibold text-white">2. Sign transaction</div>
            <div className="text-xs text-slate-400 mt-1">
              Scan or paste unsigned Payment → preview → sign → show / copy result
            </div>
          </button>
          <button
            type="button"
            onClick={lockDevice}
            className="w-full py-3 rounded-2xl bg-slate-800 text-slate-300 text-sm mt-6"
          >
            Lock device
          </button>
        </main>
      </div>
    )
  }

  // Unlock challenge — paste first (one-device), camera optional
  if (step === 'unlock-scan-chal') {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 space-y-4">
          <button
            type="button"
            className="text-xs text-slate-400"
            onClick={() => {
              setPayloadPaste('')
              setStep('actions')
            }}
          >
            ← Back
          </button>
          <h2 className="text-lg font-bold text-white">Unlock vault</h2>
          <p className="text-xs text-slate-400">
            On hot: Vault → Unlock → <strong className="text-slate-200">Copy full payload</strong>.
            Paste it below (easiest for one-device testing).
          </p>
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-800/40 rounded-xl p-3">
              {error}
            </div>
          )}
          <label className="block text-sm font-semibold text-cyan-200">
            Paste challenge from hot
            <textarea
              rows={8}
              value={payloadPaste}
              onChange={(e) => setPayloadPaste(e.target.value)}
              placeholder='{"type":"vault-unlock-chal","v":1,...}'
              className="mt-2 w-full rounded-xl bg-slate-900 border-2 border-cyan-600/50 px-3 py-3 text-[11px] font-mono text-slate-100"
            />
          </label>
          <button
            type="button"
            disabled={busy || !payloadPaste.trim()}
            onClick={() => {
              setError('')
              try {
                const payload = parsePastedTransport(payloadPaste)
                void onUnlockChallenge(payload)
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Paste failed')
              }
            }}
            className="w-full py-3.5 rounded-2xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-semibold"
          >
            Use pasted challenge
          </button>
          <button
            type="button"
            onClick={() => setStep('unlock-camera')}
            className="w-full py-3 rounded-2xl bg-slate-800 text-slate-200 text-sm"
          >
            Scan QR instead
          </button>
        </main>
      </div>
    )
  }

  if (step === 'unlock-camera') {
    return (
      <MultiQrScan
        title="Scan unlock challenge from hot"
        expectedCt="vault-unlock-chal"
        onCancel={() => setStep('unlock-scan-chal')}
        onComplete={(payload) => void onUnlockChallenge(payload)}
      />
    )
  }

  if (step === 'unlock-show-resp' && respEnc) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        <main className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-3">
          <AnimatedQr encoded={respEnc} title="Copy this → paste on hot portal" />
          <p className="text-xs text-slate-400 text-center max-w-sm">
            Use <strong className="text-slate-200">Copy full payload</strong> above, then on hot
            open the scan step and paste.
          </p>
          <button
            type="button"
            className="mt-2 px-4 py-2 rounded-xl bg-slate-800 text-sm"
            onClick={() => {
              setRespEnc(null)
              setPayloadPaste('')
              setStep('actions')
            }}
          >
            Done
          </button>
        </main>
      </div>
    )
  }

  // Sign — paste first
  if (step === 'sign-scan') {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 space-y-4">
          <button
            type="button"
            className="text-xs text-slate-400"
            onClick={() => {
              setPayloadPaste('')
              setStep('actions')
            }}
          >
            ← Back
          </button>
          <h2 className="text-lg font-bold text-white">Sign transaction</h2>
          <p className="text-xs text-slate-400">
            On hot: prepare send → <strong className="text-slate-200">Copy full payload</strong>.
            Paste the unsigned package below.
          </p>
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-800/40 rounded-xl p-3">
              {error}
            </div>
          )}
          <label className="block text-sm font-semibold text-cyan-200">
            Paste unsigned tx from hot
            <textarea
              rows={8}
              value={payloadPaste}
              onChange={(e) => setPayloadPaste(e.target.value)}
              placeholder='{"type":"falcon-unsigned-tx","v":1,...}'
              className="mt-2 w-full rounded-xl bg-slate-900 border-2 border-cyan-600/50 px-3 py-3 text-[11px] font-mono text-slate-100"
            />
          </label>
          <button
            type="button"
            disabled={!payloadPaste.trim()}
            onClick={() => {
              setError('')
              try {
                const payload = parsePastedTransport(payloadPaste)
                onUnsignedPayload(payload)
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Paste failed')
              }
            }}
            className="w-full py-3.5 rounded-2xl bg-brand-500 hover:bg-brand-400 disabled:opacity-40 text-slate-950 font-semibold"
          >
            Use pasted transaction
          </button>
          <button
            type="button"
            onClick={() => setStep('sign-camera')}
            className="w-full py-3 rounded-2xl bg-slate-800 text-slate-200 text-sm"
          >
            Scan QR instead
          </button>
        </main>
      </div>
    )
  }

  if (step === 'sign-camera') {
    return (
      <MultiQrScan
        title="Scan unsigned transaction"
        expectedCt="unsigned-tx"
        onCancel={() => setStep('sign-scan')}
        onComplete={(payload) => onUnsignedPayload(payload)}
      />
    )
  }

  if (step === 'sign-preview' && preview) {
    const d = preview.display
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 space-y-4">
          <h2 className="text-lg font-bold text-white">Review carefully</h2>
          <div className="rounded-2xl border border-amber-600/30 bg-amber-950/20 p-4 space-y-2 text-sm">
            <Row k="Type" v={d.transactionType} />
            <Row k="From" v={d.account} mono />
            <Row k="To" v={d.destination} mono />
            <Row
              k="Amount"
              v={`${(Number(d.amountDrops) / 1_000_000).toLocaleString()} FALCON`}
            />
            <Row k="Fee" v={`${d.fee} drops`} />
            <Row k="Sequence" v={String(d.sequence)} />
            <Row k="Last ledger" v={String(d.lastLedgerSequence)} />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmSign()}
            className="w-full py-4 rounded-2xl bg-brand-500 text-slate-950 font-semibold"
          >
            {busy ? 'Signing…' : 'Approve & sign'}
          </button>
          <button type="button" className="w-full text-sm text-slate-500" onClick={() => setStep('actions')}>
            Reject
          </button>
        </main>
      </div>
    )
  }

  if (step === 'sign-show' && signedEnc) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        <main className="flex-1 flex flex-col items-center justify-center px-4 py-6">
          <AnimatedQr encoded={signedEnc} title="Signed TX — scan on hot portal" />
          <button
            type="button"
            className="mt-6 px-4 py-2 rounded-xl bg-slate-800 text-sm"
            onClick={() => {
              setSignedEnc(null)
              setPreview(null)
              setStep('actions')
            }}
          >
            Done
          </button>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
      …
    </div>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{k}</span>
      <span className={`text-slate-100 break-all ${mono ? 'font-mono text-xs' : ''}`}>{v}</span>
    </div>
  )
}
