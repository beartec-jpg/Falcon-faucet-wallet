// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * Publish Multi-chain receive addresses onto Falcon PL Account.external_addrs
 * (v2.10+ SetExternalAddrs). Complements the off-chain walletd name-set-addrs
 * store used by /api/wallet/name and the tBTC faucet name resolver.
 *
 * Product path: auto-publish BTC on first wallet unlock when on-chain
 * external_addrs.btc is empty — see docs/BTC4-EXTERNAL-ADDRS-FIXPLAN.md.
 */

import { signPlSetExternalAddr, type SignedPlTx } from '@/lib/pl-wallet-sign'
import type { NetworkKey } from '@/lib/networks'

export type ExternalAddrMap = Partial<Record<'btc' | 'eth' | 'bnb' | 'xrp', string>>

async function submitSigned(tx: SignedPlTx, networkKey: NetworkKey): Promise<{ txId: string }> {
  const res = await fetch('/api/wallet/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      tx.rawJson ? { tx_json: tx.rawJson, network: networkKey } : { tx, network: networkKey },
    ),
  })
  const out = (await res.json().catch(() => ({}))) as {
    error?: string
    message?: string
    success?: boolean
  }
  if (!res.ok || out.error || out.success === false) {
    throw new Error(out.error || out.message || `Submit failed (HTTP ${res.status})`)
  }
  return { txId: tx.tx_id }
}

/** True when on-ledger BTC receive address is missing or differs from local Multi-chain BTC. */
export function needsOnChainBtcLink(
  localBtc: string | undefined | null,
  already?: Record<string, string> | null,
): boolean {
  const want = localBtc?.trim()
  if (!want) return false
  const onChain = already?.btc?.trim()
  return !onChain || onChain !== want
}

export async function publishExternalAddrsOnChain(opts: {
  account: string
  falconSecret: string
  /** Next account sequence (increments by one per chain published). */
  sequence: number
  addrs: ExternalAddrMap
  networkKey: NetworkKey
  fee?: number
  networkId?: number
  /** Skip chains already equal on-ledger (case-sensitive trim match). */
  already?: Record<string, string>
}): Promise<{ published: Array<{ chain: string; address: string; txId: string }>; nextSequence: number }> {
  const published: Array<{ chain: string; address: string; txId: string }> = []
  let seq = opts.sequence
  const order: Array<keyof ExternalAddrMap> = ['btc', 'eth', 'bnb', 'xrp']
  for (const chain of order) {
    const address = opts.addrs[chain]?.trim()
    if (!address) continue
    const prior = opts.already?.[chain]?.trim()
    if (prior && prior === address) continue
    const signed = await signPlSetExternalAddr({
      account: opts.account,
      chain,
      address,
      sequence: seq,
      fee: opts.fee,
      networkId: opts.networkId,
      falconSecret: opts.falconSecret,
    })
    const { txId } = await submitSigned(signed, opts.networkKey)
    published.push({ chain, address, txId })
    seq += 1
  }
  return { published, nextSequence: seq }
}

/** BTC-only publish used on first unlock (eth/bnb/xrp deferred). */
export async function publishBtcExternalAddrOnChain(opts: {
  account: string
  falconSecret: string
  sequence: number
  btcAddress: string
  networkKey: NetworkKey
  fee?: number
  networkId?: number
  already?: Record<string, string>
}): Promise<{ published: boolean; txId?: string; nextSequence: number }> {
  const result = await publishExternalAddrsOnChain({
    account: opts.account,
    falconSecret: opts.falconSecret,
    sequence: opts.sequence,
    addrs: { btc: opts.btcAddress },
    networkKey: opts.networkKey,
    fee: opts.fee,
    networkId: opts.networkId,
    already: opts.already,
  })
  const btc = result.published.find((p) => p.chain === 'btc')
  return {
    published: Boolean(btc),
    txId: btc?.txId,
    nextSequence: result.nextSequence,
  }
}
