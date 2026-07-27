import { useCallback, useEffect, useState } from 'react'
import OfflineWall from './components/OfflineWall'
import { AnimatedQr, MultiQrScan } from './components/MultiQr'
import {
  assertOfflineForOps,
  allowOnlineOverride,
  readOnlineState,
} from './lib/offlineGate'
import {
  hasColdVault,
  loadColdVaultMeta,
  saveColdVaultWithPassword,
  saveColdVaultWithPasskey,
  unlockColdVaultWithPassword,
  unlockColdVaultWithPasskey,
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
} from '@/lib/vault-protocol'
import { encodeMultiQr, type EncodedMultiQr, b64uEncode } from '@/lib/multi-qr'
import { signTxJson } from '@/lib/falcon-tx-sign'
import { decodeFalconSecret, zeroize } from '@/lib/falcon-keys'
import { getFalcon512 } from '@/lib/falcon-wasm'

type Step =
  | 'boot'
  | 'install-hint' // online allowed: install PWA only
  | 'empty' // offline, no vault
  | 'import'
  | 'locked'
  | 'actions' // unlocked: action list
  | 'unlock-scan-chal'
  | 'unlock-show-resp'
  | 'sign-scan'
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
  const [vaultPass, setVaultPass] = useState('')
  const [coldPass, setColdPass] = useState('')
  const [coldPass2, setColdPass2] = useState('')
  /** How to protect secret on this cold device after import */
  const [importMethod, setImportMethod] = useState<'password' | 'passkey'>(
    isPasskeySupported() ? 'passkey' : 'password',
  )

  // Unlock / sign QR
  const [respEnc, setRespEnc] = useState<EncodedMultiQr | null>(null)
  const [preview, setPreview] = useState<ReturnType<typeof parseUnsignedPayment> | null>(null)
  const [signedEnc, setSignedEnc] = useState<EncodedMultiQr | null>(null)

  const [deferredPrompt, setDeferredPrompt] = useState<{
    prompt: () => Promise<void>
  } | null>(null)

  const refreshOnline = useCallback(() => {
    setOnline(readOnlineState().online)
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
    const h = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as unknown as { prompt: () => Promise<void> })
    }
    window.addEventListener('beforeinstallprompt', h)
    return () => window.removeEventListener('beforeinstallprompt', h)
  }, [])

  useEffect(() => {
    ;(async () => {
      const has = await hasColdVault()
      const m = has ? await loadColdVaultMeta() : null
      setMeta(m)
      if (online && !allowOnlineOverride()) {
        setStep(has ? 'install-hint' : 'install-hint')
      } else {
        setStep(has ? 'locked' : 'empty')
      }
    })().catch((e) => {
      setError(e instanceof Error ? e.message : 'Boot failed')
      setStep('empty')
    })
  }, [online])

  // Hard gate: if we go online mid-session, wipe session keys and wall
  useEffect(() => {
    if (online && !allowOnlineOverride()) {
      if (session) {
        // best-effort clear
        setSession(null)
      }
      setStep((s) => (s === 'boot' ? s : 'install-hint'))
    }
  }, [online, session])

  const opsBlocked = online && !allowOnlineOverride()

  // ── Import vault file ───────────────────────────────────────────────────────

  async function handleImport() {
    setError('')
    try {
      assertOfflineForOps()
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
        if (!isPasskeySupported()) throw new Error('Passkeys not supported on this device')
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
      assertOfflineForOps()
      setBusy(true)
      const keys = await unlockColdVaultWithPassword(coldPass)
      setColdPass('')
      setSession(keys)
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
      assertOfflineForOps()
      if (!meta?.credentialId) throw new Error('No passkey registered for this vault')
      setBusy(true)
      const auth = await authenticateColdPasskey(meta.credentialId, !!meta.hasPrf)
      const keys = await unlockColdVaultWithPasskey(auth.keyBytes)
      setSession(keys)
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
      assertOfflineForOps()
      if (!session) throw new Error('Unlock cold device first')
      const chal = parseUnlockChallenge(payload)
      if (chal.address !== session.address) {
        throw new Error('Challenge address does not match this vault')
      }
      if (Date.now() > chal.expiresAt) throw new Error('Challenge expired — regenerate on hot')
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
      assertOfflineForOps()
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
      assertOfflineForOps()
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
    setStep(opsBlocked ? 'install-hint' : 'empty')
  }

  // ── Online wall ─────────────────────────────────────────────────────────────

  if (opsBlocked && step !== 'install-hint') {
    // fall through to wall via install-hint
  }

  if (opsBlocked) {
    return (
      <OfflineWall
        installMode={!meta}
        canInstall={!!deferredPrompt}
        onInstall={() => void deferredPrompt?.prompt()}
        onRetry={() => {
          refreshOnline()
          if (!navigator.onLine) {
            setStep(meta ? 'locked' : 'empty')
          }
        }}
      />
    )
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
        {online ? 'Online' : 'Offline'}
      </span>
    </header>
  )

  if (step === 'boot') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 text-sm">
        Loading…
      </div>
    )
  }

  if (step === 'install-hint' && !opsBlocked) {
    // shouldn't stick when offline
  }

  // Empty — import
  if (step === 'empty' || step === 'import') {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 space-y-4">
          <h1 className="text-xl font-bold text-white">Import vault</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            Load the encrypted vault JSON from offline media (SD card / USB). Keep a copy offline
            forever — this device never phones home.
          </p>
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-800/40 rounded-xl p-3">
              {error}
            </div>
          )}
          <label className="block text-xs text-slate-400">
            Vault file
            <input
              type="file"
              accept="application/json,.json"
              className="mt-1 block w-full text-sm text-slate-300"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setFileText(await f.text())
              }}
            />
          </label>
          {fileText && (
            <p className="text-[11px] text-emerald-400">File loaded ({fileText.length} bytes)</p>
          )}
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
              <button
                type="button"
                onClick={() => setImportMethod('password')}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold border ${
                  importMethod === 'password'
                    ? 'border-cyan-500 bg-cyan-950/50 text-cyan-200'
                    : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
              >
                Password
              </button>
            </div>
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
          {importMethod === 'passkey' && (
            <p className="text-[11px] text-slate-500">
              You will register a device passkey (Face ID / fingerprint). Prefer PRF-capable browsers
              (Chrome 115+, Safari 17.4+).
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleImport()}
            className="w-full py-3.5 rounded-2xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold"
          >
            {busy ? 'Importing…' : importMethod === 'passkey' ? 'Import with passkey' : 'Import offline'}
          </button>
          {deferredPrompt && (
            <button
              type="button"
              className="w-full py-2 text-xs text-cyan-400"
              onClick={() => void deferredPrompt.prompt()}
            >
              Install to Home Screen
            </button>
          )}
        </main>
      </div>
    )
  }

  // Locked
  if (step === 'locked') {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-10 space-y-6">
          <div className="text-center">
            <div className="text-4xl mb-3">🔒</div>
            <h1 className="text-xl font-bold text-white">{meta?.label ?? 'Vault'}</h1>
            <p className="text-[11px] font-mono text-slate-500 break-all mt-2 px-4">
              {meta?.address}
            </p>
          </div>
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

  // Action list
  if (step === 'actions' && session) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-6 space-y-3">
          <p className="text-xs text-slate-500 font-mono break-all mb-4">{session.address}</p>
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-800/40 rounded-xl p-3">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={() => setStep('unlock-scan-chal')}
            className="w-full text-left px-4 py-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-cyan-600/50"
          >
            <div className="font-semibold text-white">1. Unlock vault</div>
            <div className="text-xs text-slate-400 mt-1">
              Scan challenge from hot portal → show response QR
            </div>
          </button>
          <button
            type="button"
            onClick={() => setStep('sign-scan')}
            className="w-full text-left px-4 py-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-brand-500/40"
          >
            <div className="font-semibold text-white">2. Sign transaction</div>
            <div className="text-xs text-slate-400 mt-1">
              Scan unsigned Payment QR → preview → sign → show result
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

  if (step === 'unlock-scan-chal') {
    return (
      <MultiQrScan
        title="Scan unlock challenge from hot"
        expectedCt="vault-unlock-chal"
        onCancel={() => setStep('actions')}
        onComplete={(payload) => void onUnlockChallenge(payload)}
      />
    )
  }

  if (step === 'unlock-show-resp' && respEnc) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        {header}
        <main className="flex-1 flex flex-col items-center justify-center px-4 py-6">
          <AnimatedQr encoded={respEnc} title="Show this to hot portal" />
          <button
            type="button"
            className="mt-6 px-4 py-2 rounded-xl bg-slate-800 text-sm"
            onClick={() => {
              setRespEnc(null)
              setStep('actions')
            }}
          >
            Done
          </button>
        </main>
      </div>
    )
  }

  if (step === 'sign-scan') {
    return (
      <MultiQrScan
        title="Scan unsigned transaction"
        expectedCt="unsigned-tx"
        onCancel={() => setStep('actions')}
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
