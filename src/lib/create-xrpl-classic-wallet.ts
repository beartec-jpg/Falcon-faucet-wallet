/**
 * Classic XRPL multi-chain wallet (today’s XRP Ledger crypto).
 *
 * Separate from Falcon-512 keys:
 *  - secp256k1 / ed25519 family seed (s…)
 *  - own classic r… address (not the Falcon r…)
 *  - signs in-browser; balance/submit via same-origin API (CORS-safe)
 *
 * Stored encrypted under the same passkey vault as ETH/BTC keys.
 */

import { Wallet } from 'xrpl'
import { authenticatePasskey } from '@/lib/passkey'
import { encryptSeed, type EncryptedSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, saveWallet, type StoredWallet } from '@/lib/wallet-store'

export type XrplClassicNetwork = 'testnet' | 'mainnet'

/** Public WebSocket endpoints (docs / optional direct use). */
export const XRPL_CLASSIC_WS: Record<XrplClassicNetwork, string> = {
  testnet: process.env.NEXT_PUBLIC_XRPL_CLASSIC_TESTNET_WS?.trim()
    || 'wss://s.altnet.rippletest.net:51233',
  mainnet: process.env.NEXT_PUBLIC_XRPL_CLASSIC_MAINNET_WS?.trim()
    || 'wss://xrplcluster.com',
}

export const XRPL_CLASSIC_HTTP: Record<XrplClassicNetwork, string> = {
  testnet: process.env.NEXT_PUBLIC_XRPL_CLASSIC_TESTNET_RPC?.trim()
    || 'https://s.altnet.rippletest.net:51234',
  mainnet: process.env.NEXT_PUBLIC_XRPL_CLASSIC_MAINNET_RPC?.trim()
    || 'https://xrplcluster.com',
}

/** XLS-37 NetworkID (omit / 0 on mainnet). */
const XRPL_NETWORK_ID: Record<XrplClassicNetwork, number | undefined> = {
  testnet: 1,
  mainnet: undefined,
}

export function hasXrplClassicWallet(
  wallet: Pick<StoredWallet, 'xrplClassicAddress' | 'xrplClassicEncrypted'>,
): boolean {
  return !!(wallet.xrplClassicAddress && wallet.xrplClassicEncrypted)
}

export function createRandomXrplClassicWallet(): {
  seed: string
  address: string
  publicKey: string
} {
  const w = Wallet.generate()
  if (!w.seed) throw new Error('Failed to generate classic XRPL seed')
  return {
    seed: w.seed,
    address: w.classicAddress,
    publicKey: w.publicKey,
  }
}

export async function encryptXrplClassicSeedForPasskey(
  seed: string,
  keyBytes: Uint8Array,
  hasPrf: boolean,
): Promise<{ address: string; publicKey: string; xrplClassicEncrypted: EncryptedSeed }> {
  const trimmed = seed.trim()
  const w = Wallet.fromSeed(trimmed)
  const xrplClassicEncrypted = await encryptSeed(trimmed, keyBytes, hasPrf)
  return {
    address: w.classicAddress,
    publicKey: w.publicKey,
    xrplClassicEncrypted,
  }
}

export async function createXrplClassicWalletForPasskey(
  keyBytes: Uint8Array,
  hasPrf: boolean,
): Promise<{
  seed: string
  address: string
  publicKey: string
  xrplClassicEncrypted: EncryptedSeed
}> {
  const { seed, address, publicKey } = createRandomXrplClassicWallet()
  const xrplClassicEncrypted = await encryptSeed(seed, keyBytes, hasPrf)
  return { seed, address, publicKey, xrplClassicEncrypted }
}

/** Add classic XRPL keys to an existing Falcon wallet (passkey prompt). */
export async function provisionXrplClassicWalletForStoredWallet(
  wallet: StoredWallet,
): Promise<StoredWallet> {
  if (hasXrplClassicWallet(wallet)) return wallet
  const { keyBytes, hasPrf } = await authenticatePasskey(wallet.credentialId, wallet.hasPrf)
  const classic = await createXrplClassicWalletForPasskey(keyBytes, hasPrf)
  const updated: StoredWallet = {
    ...wallet,
    xrplClassicAddress: classic.address,
    xrplClassicPublicKey: classic.publicKey,
    xrplClassicEncrypted: classic.xrplClassicEncrypted,
  }
  await saveWallet(updated)
  const reloaded = await loadPrimaryWallet()
  if (!reloaded || !hasXrplClassicWallet(reloaded)) {
    throw new Error('Classic XRPL wallet could not be saved — try again in this browser tab')
  }
  return reloaded
}

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

/**
 * XRPL JSON-RPC helper.
 * Browser → same-origin `/api/wallet/xrpl-rpc` (avoids CORS/CSP).
 * Server → direct public HTTP endpoint.
 */
export async function xrplClassicRpc<T = unknown>(
  network: XrplClassicNetwork,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  if (isBrowser()) {
    let res: Response
    try {
      res = await fetch('/api/wallet/xrpl-rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params, network }),
        cache: 'no-store',
      })
    } catch {
      throw new Error('Could not reach wallet XRPL API (network offline?)')
    }
    const body = (await res.json()) as {
      result?: T & { error?: string; error_message?: string }
      error?: string | unknown
    }
    if (!res.ok) {
      const err =
        typeof body.error === 'string'
          ? body.error
          : body.error && typeof body.error === 'object' && 'message' in body.error
            ? String((body.error as { message?: string }).message)
            : `XRPL classic RPC HTTP ${res.status}`
      throw new Error(err)
    }
    const result = body.result
    if (!result) throw new Error('XRPL classic RPC empty result')
    if ((result as { error?: string }).error) {
      const err = result as { error?: string; error_message?: string }
      throw new Error(err.error_message || err.error || 'XRPL classic RPC error')
    }
    return result
  }

  const url = XRPL_CLASSIC_HTTP[network]
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`XRPL classic RPC HTTP ${res.status}`)
  const body = (await res.json()) as {
    result?: T & { error?: string; error_message?: string }
    error?: unknown
  }
  const result = body.result
  if (!result || (result as { error?: string }).error) {
    const err = result as { error?: string; error_message?: string } | undefined
    throw new Error(err?.error_message || err?.error || 'XRPL classic RPC error')
  }
  return result
}

function dropsToXrp(drops: string): string {
  const n = BigInt(drops)
  const whole = n / 1_000_000n
  const frac = n % 1_000_000n
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

export async function fetchXrplClassicXrpBalance(
  address: string,
  network: XrplClassicNetwork = 'testnet',
): Promise<string | null> {
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address.trim())) return null

  // Prefer dedicated same-origin balance route in the browser
  if (isBrowser()) {
    try {
      const r = await fetch(
        `/api/wallet/xrpl-balance?address=${encodeURIComponent(address.trim())}&network=${network}`,
        { cache: 'no-store' },
      )
      if (r.ok) {
        const j = (await r.json()) as { balance?: string | null }
        if (j.balance != null) return j.balance
      }
    } catch {
      /* fall through to RPC helper */
    }
  }

  try {
    const r = await xrplClassicRpc<{
      account_data?: { Balance?: string }
      error?: string
    }>(network, 'account_info', {
      account: address.trim(),
      ledger_index: 'validated',
      strict: true,
    })
    if (r.error === 'actNotFound' || !r.account_data?.Balance) return '0'
    return dropsToXrp(r.account_data.Balance)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('actNotFound') || msg.includes('Account not found')) return '0'
    console.warn('fetchXrplClassicXrpBalance', msg)
    return null
  }
}

/** Sign in-browser + submit signed blob via same-origin proxy (testnet by default). */
export async function sendClassicXrpPayment(opts: {
  seed: string
  destination: string
  amountXrp: string
  network?: XrplClassicNetwork
}): Promise<{ hash: string; engine_result: string }> {
  const network = opts.network ?? 'testnet'
  const wallet = Wallet.fromSeed(opts.seed.trim())
  const drops = String(Math.round(parseFloat(opts.amountXrp) * 1_000_000))
  if (!/^\d+$/.test(drops) || drops === '0') throw new Error('Invalid XRP amount')
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(opts.destination.trim())) {
    throw new Error('Invalid classic XRPL destination')
  }

  let info: { account_data?: { Sequence?: number }; error?: string }
  try {
    info = await xrplClassicRpc(network, 'account_info', {
      account: wallet.classicAddress,
      ledger_index: 'current',
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('actNotFound') || msg.includes('Account not found')) {
      throw new Error(
        network === 'testnet'
          ? 'Classic XRPL testnet account not funded yet — use the XRPL testnet faucet'
          : 'Classic XRPL account not found / unfunded',
      )
    }
    throw e
  }
  if (info.error === 'actNotFound' || !info.account_data?.Sequence) {
    throw new Error(
      network === 'testnet'
        ? 'Classic XRPL testnet account not funded yet — use the XRPL testnet faucet'
        : 'Classic XRPL account not found / unfunded',
    )
  }

  const feeR = await xrplClassicRpc<{
    drops?: { open_ledger_fee?: string; median_fee?: string; minimum_fee?: string }
  }>(network, 'fee', {})
  const fee =
    feeR.drops?.open_ledger_fee ||
    feeR.drops?.median_fee ||
    feeR.drops?.minimum_fee ||
    '12'

  let lastLedger = 0
  try {
    const cur = await xrplClassicRpc<{ ledger_current_index?: number }>(
      network,
      'ledger_current',
      {},
    )
    lastLedger = (cur.ledger_current_index ?? 0) + 20
  } catch {
    lastLedger = 0
  }

  const networkId = XRPL_NETWORK_ID[network]
  const tx: Record<string, unknown> = {
    TransactionType: 'Payment',
    Account: wallet.classicAddress,
    Destination: opts.destination.trim(),
    Amount: drops,
    Sequence: info.account_data.Sequence,
    Fee: fee,
  }
  if (lastLedger > 0) tx.LastLedgerSequence = lastLedger
  if (networkId != null) tx.NetworkID = networkId

  // Sign via xrpl.Wallet (secp256k1 / ed25519 — not Falcon-512). Seed never leaves the device.
  const signed = wallet.sign(tx as never)
  const submit = await xrplClassicRpc<{
    engine_result?: string
    engine_result_message?: string
    tx_json?: { hash?: string }
  }>(network, 'submit', { tx_blob: signed.tx_blob })

  const eng = submit.engine_result || 'unknown'
  if (!eng.startsWith('tes') && !eng.startsWith('ter')) {
    throw new Error(
      `XRPL submit: ${eng}${submit.engine_result_message ? ` — ${submit.engine_result_message}` : ''}`,
    )
  }
  return {
    hash: signed.hash || submit.tx_json?.hash || '',
    engine_result: eng,
  }
}
