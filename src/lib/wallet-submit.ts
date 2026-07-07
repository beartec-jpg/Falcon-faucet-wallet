import { withNetworkQuery } from '@/lib/network-query'
import type { NetworkKey } from '@/lib/networks'

/** AMMCreate charges one owner reserve as the transaction fee (~2 FALCON on testnet). */
export const AMM_CREATE_FEE_DROPS = '2000000'

/** Default number of ledgers ahead used for LastLedgerSequence when signing. */
export const DEFAULT_LEDGER_OFFSET = 20

/**
 * Engine results that mean the transaction's Sequence was stale relative to the
 * account's current sequence (another write landed first, or a cached sequence
 * was used). These are safe to retry after re-fetching a fresh sequence.
 */
const SEQUENCE_RETRY_RESULTS = new Set(['tefPAST_SEQ', 'terPRE_SEQ'])

export interface SubmitResult {
  success: boolean
  hash?: string
  result?: string
  message?: string
  error?: string
}

/** Low-level POST to the submit relay. Throws only on transport/server errors. */
async function postSubmit(tx_blob: string, networkKey: string): Promise<SubmitResult> {
  const res = await fetch('/api/wallet/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_blob, network: networkKey }),
  })
  const data = (await res.json().catch(() => ({}))) as SubmitResult
  if (data.error) {
    throw new Error(data.error)
  }
  return data
}

export async function submitWalletTx(
  tx_blob: string,
  networkKey: string,
): Promise<SubmitResult> {
  const data = await postSubmit(tx_blob, networkKey)
  if (!data.success) {
    const detail = [data.result, data.message].filter(Boolean).join(' — ')
    throw new Error(detail || 'Transaction failed')
  }
  return data
}

export interface SequenceInfo {
  sequence: number
  currentLedger: number
}

/**
 * Fetch the account's current sequence and the latest validated ledger index,
 * used to build a fresh transaction just before signing. Throws if the node is
 * unreachable or the account does not exist on-ledger.
 */
export async function fetchSequenceInfo(
  address: string,
  networkKey: NetworkKey,
): Promise<SequenceInfo & { exists: boolean }> {
  const res = await fetch(
    withNetworkQuery(`/api/wallet/account?address=${encodeURIComponent(address)}`, networkKey),
  )
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) {
    throw new Error((data && data.error) || 'Failed to refresh account')
  }
  return {
    sequence: data.sequence ?? 0,
    currentLedger: data.currentLedger ?? 0,
    exists: !!data.exists,
  }
}

export interface SequencedSubmitOptions {
  networkKey: NetworkKey
  /** Re-fetches a fresh sequence + validated ledger index before every attempt. */
  fetchSequence: () => Promise<SequenceInfo>
  /**
   * Signs the transaction for the supplied sequence and returns a tx_blob.
   * Signing runs in-browser (WASM); the falcon_secret must stay in this closure
   * and never be sent to a server. Re-invoked with a corrected sequence on retry.
   */
  sign: (seq: { sequence: number; lastLedgerSequence: number }) => Promise<{ tx_blob: string }>
  ledgerOffset?: number
  maxAttempts?: number
}

/**
 * Sign and submit a transaction, transparently recovering from sequence-number
 * races. If the ledger rejects the submission with tefPAST_SEQ/terPRE_SEQ, the
 * account sequence is re-fetched and the transaction is re-signed and resubmitted
 * (up to `maxAttempts`). Returns the successful SubmitResult, or throws with the
 * final engine result if every attempt fails.
 */
export async function submitWithSequenceRetry(
  opts: SequencedSubmitOptions,
): Promise<SubmitResult> {
  const ledgerOffset = opts.ledgerOffset ?? DEFAULT_LEDGER_OFFSET
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3)
  let lastResult: SubmitResult | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { sequence, currentLedger } = await opts.fetchSequence()
    const { tx_blob } = await opts.sign({
      sequence,
      lastLedgerSequence: currentLedger + ledgerOffset,
    })
    const data = await postSubmit(tx_blob, opts.networkKey)
    if (data.success) return data

    lastResult = data
    const retriable = data.result != null && SEQUENCE_RETRY_RESULTS.has(data.result)
    if (!retriable || attempt === maxAttempts - 1) break
    // Brief backoff so the fresh account_info reflects the winning transaction.
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
  }

  const detail = [lastResult?.result, lastResult?.message].filter(Boolean).join(' — ')
  throw new Error(detail || 'Transaction failed')
}