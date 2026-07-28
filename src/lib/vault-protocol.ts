/**
 * Falcon vault QR protocol payloads (UTF-8 JSON inside multi-QR bodies).
 *
 * Unlock: hot → challenge multi-QR (+ on-chain snapshot), cold → response multi-QR.
 * Send:   hot → unsigned Payment package, cold → signed tx_blob.
 *
 * For one-device testing, the same JSON can be copied/pasted instead of scanned.
 */

import { b64uDecode, b64uEncode, MultiQrAssembler } from './multi-qr'

export const VAULT_PROTOCOL_VERSION = 1 as const
export const CODEC_VERSION = 'falcon-ledger-codec-v1'
export const UNLOCK_DOMAIN = 'FALCON-VAULT-UNLOCK-V1'

// ── On-chain snapshot (hot → cold via unlock challenge) ───────────────────────

/** Read-only account view for the cold device (no secrets). */
export interface VaultAccountSnapshot {
  balance: number
  exists: boolean
  sequence: number
  currentLedger: number
  /** Unix ms when hot fetched this */
  fetchedAt: number
  networkKey?: string
  fusdc?: {
    balance: number
    currency?: string
    issuer?: string
    hasTrustLine?: boolean
  }
}

// ── Unlock challenge / response ───────────────────────────────────────────────

export interface VaultUnlockChallenge {
  type: 'vault-unlock-chal'
  v: typeof VAULT_PROTOCOL_VERSION
  address: string
  /** base64url 32-byte random */
  challenge: string
  /** Unix ms */
  expiresAt: number
  /** Live on-chain details from hot (updates each unlock) */
  account?: VaultAccountSnapshot
}

export interface VaultUnlockResponse {
  type: 'vault-unlock-resp'
  v: typeof VAULT_PROTOCOL_VERSION
  address: string
  challenge: string
  expiresAt: number
  /** base64url Falcon-512 signature over unlockMessageBytes(...) */
  sig: string
}

export function buildUnlockMessage(params: {
  address: string
  challenge: string
  expiresAt: number
}): Uint8Array {
  // Snapshot is NOT part of the signed message — display only
  const text = `${UNLOCK_DOMAIN}\n${params.address}\n${params.challenge}\n${params.expiresAt}`
  return new TextEncoder().encode(text)
}

export function createUnlockChallenge(
  address: string,
  ttlMs = 120_000,
  account?: VaultAccountSnapshot,
): VaultUnlockChallenge {
  const challengeBytes = crypto.getRandomValues(new Uint8Array(32))
  return {
    type: 'vault-unlock-chal',
    v: VAULT_PROTOCOL_VERSION,
    address,
    challenge: b64uEncode(challengeBytes),
    expiresAt: Date.now() + ttlMs,
    ...(account ? { account } : {}),
  }
}

export function parseUnlockChallenge(payload: string): VaultUnlockChallenge {
  const obj = JSON.parse(payload) as VaultUnlockChallenge
  if (obj.type !== 'vault-unlock-chal' || obj.v !== VAULT_PROTOCOL_VERSION) {
    throw new Error('Not a vault unlock challenge')
  }
  if (!obj.address || !obj.challenge || !obj.expiresAt) {
    throw new Error('Invalid unlock challenge')
  }
  return obj
}

export function parseUnlockResponse(payload: string): VaultUnlockResponse {
  const obj = JSON.parse(payload) as VaultUnlockResponse
  if (obj.type !== 'vault-unlock-resp' || obj.v !== VAULT_PROTOCOL_VERSION) {
    throw new Error('Not a vault unlock response')
  }
  if (!obj.address || !obj.challenge || !obj.sig || !obj.expiresAt) {
    throw new Error('Invalid unlock response')
  }
  return obj
}

export function encodeUnlockChallenge(c: VaultUnlockChallenge): string {
  return JSON.stringify(c)
}

export function encodeUnlockResponse(r: VaultUnlockResponse): string {
  return JSON.stringify(r)
}

export function unlockResponseSigBytes(r: VaultUnlockResponse): Uint8Array {
  return b64uDecode(r.sig)
}

// ── Unsigned / signed payment packages ────────────────────────────────────────

export interface VaultUnsignedPayment {
  type: 'falcon-unsigned-tx'
  v: typeof VAULT_PROTOCOL_VERSION
  codecVersion: typeof CODEC_VERSION
  networkId: number
  display: {
    transactionType: 'Payment'
    account: string
    destination: string
    /**
     * Native FALCON: amount in drops.
     * F-USDC: human amount string (same as IOU value).
     */
    amountDrops: string
    /** Display asset; default FALCON for older packages */
    asset?: 'FALCON' | 'F-USDC'
    fee: string
    sequence: number
    lastLedgerSequence: number
  }
  /** Full tx_json ready for encodeForSigning (SigningPubKey set, no TxnSignature) */
  tx_json: Record<string, unknown>
}

export interface VaultSignedTx {
  type: 'falcon-signed-tx'
  v: typeof VAULT_PROTOCOL_VERSION
  tx_blob: string
  hash?: string
}

export function parseUnsignedPayment(payload: string): VaultUnsignedPayment {
  const obj = JSON.parse(payload) as VaultUnsignedPayment
  if (obj.type !== 'falcon-unsigned-tx' || obj.v !== VAULT_PROTOCOL_VERSION) {
    throw new Error('Not an unsigned vault transaction')
  }
  if (obj.codecVersion !== CODEC_VERSION) {
    throw new Error(`Codec version mismatch: ${obj.codecVersion} (need ${CODEC_VERSION})`)
  }
  if (!obj.tx_json || obj.display?.transactionType !== 'Payment') {
    throw new Error('Invalid unsigned payment package')
  }
  return obj
}

export function parseSignedTx(payload: string): VaultSignedTx {
  const obj = JSON.parse(payload) as VaultSignedTx
  if (obj.type !== 'falcon-signed-tx' || obj.v !== VAULT_PROTOCOL_VERSION) {
    throw new Error('Not a signed vault transaction')
  }
  if (!obj.tx_blob || typeof obj.tx_blob !== 'string') {
    throw new Error('Invalid signed transaction package')
  }
  return obj
}

export function encodeUnsignedPayment(p: VaultUnsignedPayment): string {
  return JSON.stringify(p)
}

export function encodeSignedTx(p: VaultSignedTx): string {
  return JSON.stringify(p)
}

/**
 * Accept paste of either a full protocol JSON body, or multi-QR frame JSON lines.
 * Returns the reassembled UTF-8 protocol payload string.
 */
export function parsePastedTransport(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Nothing pasted')

  // Full protocol object
  try {
    const obj = JSON.parse(trimmed) as { type?: string; mid?: string; n?: number }
    if (obj.type && !obj.mid) return trimmed
    // Single multi-QR frame alone is incomplete unless n===1
    if (obj.mid && typeof obj.n === 'number') {
      const asm = new MultiQrAssembler()
      const done = asm.addFrame(trimmed)
      if (done !== null) return done
      throw new Error('Pasted a single multi-QR frame — paste all frames or the full JSON payload')
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Pasted a single')) throw e
    // fall through — maybe multi-line frames
  }

  // Multiple frames: one JSON object per line
  const lines = trimmed.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  if (lines.length > 1) {
    const asm = new MultiQrAssembler()
    let result: string | null = null
    for (const line of lines) {
      result = asm.addFrame(line)
    }
    if (result !== null) return result
    throw new Error(`Incomplete multi-QR paste (${asm.receivedCount}/${asm.expectedCount || '?'} frames)`)
  }

  // Pretty-printed multi-frame array
  try {
    const arr = JSON.parse(trimmed) as unknown
    if (Array.isArray(arr) && arr.every((x) => typeof x === 'string' || typeof x === 'object')) {
      const asm = new MultiQrAssembler()
      let result: string | null = null
      for (const item of arr) {
        const frame = typeof item === 'string' ? item : JSON.stringify(item)
        result = asm.addFrame(frame)
      }
      if (result !== null) return result
    }
  } catch {
    /* ignore */
  }

  throw new Error('Paste the full JSON payload (or all multi-QR frame lines)')
}
