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

import { authenticatePasskey } from '@/lib/passkey'
import { encryptSeed, type EncryptedSeed } from '@/lib/wallet-crypto'
import { loadPrimaryWallet, saveWallet, type StoredWallet } from '@/lib/wallet-store'
import {
  XRPL_CLASSIC_HTTP,
  XRPL_CLASSIC_WS,
  fetchXrplClassicXrpBalance,
  xrplClassicRpc,
  type XrplClassicNetwork,
} from '@/lib/xrpl-classic-rpc'

export type { XrplClassicNetwork }
export { XRPL_CLASSIC_HTTP, XRPL_CLASSIC_WS, fetchXrplClassicXrpBalance, xrplClassicRpc }

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

async function xrplWallet() {
  const { Wallet } = await import('xrpl')
  return Wallet
}

export async function createRandomXrplClassicWallet(): Promise<{
  seed: string
  address: string
  publicKey: string
}> {
  const Wallet = await xrplWallet()
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
  const Wallet = await xrplWallet()
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
  const { seed, address, publicKey } = await createRandomXrplClassicWallet()
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

/** Sign in-browser + submit signed blob via same-origin proxy (testnet by default). */
export async function sendClassicXrpPayment(opts: {
  seed: string
  destination: string
  amountXrp: string
  network?: XrplClassicNetwork
}): Promise<{ hash: string; engine_result: string }> {
  const network = opts.network ?? 'testnet'
  const Wallet = await xrplWallet()
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
