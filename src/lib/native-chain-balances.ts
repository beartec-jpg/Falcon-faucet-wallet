/**
 * Read-only native balances + simple sends for multi-chain deposit wallets.
 */

import { JsonRpcProvider, Wallet, parseUnits, formatUnits } from 'ethers'
import { fetchBtcBalance, type BtcBalance, type BtcNetwork } from '@/lib/btc-client'

export type { BtcBalance }

const BSC_TESTNET_RPCS = [
  'https://bsc-testnet-rpc.publicnode.com',
  'https://data-seed-prebsc-1-s1.binance.org:8545',
  'https://bsc-testnet.drpc.org',
  'https://rpc.ankr.com/bsc_testnet_chapel',
] as const

const BSC_TESTNET_CHAIN_ID = 97

export async function fetchBnbTestnetBalance(address: string): Promise<string | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null

  // Prefer same-origin proxy (CSP / browser RPC often blocks public BSC endpoints)
  try {
    const r = await fetch(
      `/api/wallet/bnb-balance?address=${encodeURIComponent(address)}`,
      { cache: 'no-store' },
    )
    if (r.ok) {
      const j = (await r.json()) as { bnb?: string }
      if (j.bnb != null && j.bnb !== '') return j.bnb
    }
  } catch {
    /* fall through */
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
  })
  for (const url of BSC_TESTNET_RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!r.ok) continue
      const j = (await r.json()) as { result?: string; error?: unknown }
      if (j.error || !j.result) continue
      const wei = BigInt(j.result)
      return formatUnits(wei, 18)
    } catch {
      /* try next */
    }
  }
  return null
}

async function resolveBscProvider(): Promise<JsonRpcProvider> {
  let lastErr: unknown
  for (const url of BSC_TESTNET_RPCS) {
    try {
      const p = new JsonRpcProvider(url, BSC_TESTNET_CHAIN_ID, { staticNetwork: true })
      await p.getBlockNumber()
      return p
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('BSC testnet RPC unavailable')
}

/** Send native BNB on BSC testnet (same 0x key as ETH). */
export async function sendBnbTestnet(opts: {
  evmPrivateKey: string
  to: string
  amountBnb: string
}): Promise<string> {
  const p = await resolveBscProvider()
  const signer = new Wallet(opts.evmPrivateKey, p)
  const value = parseUnits(opts.amountBnb, 18)
  const bal = await p.getBalance(signer.address)
  if (value > bal) {
    throw new Error(
      `Amount exceeds BNB balance (${formatUnits(bal, 18)} available)`,
    )
  }
  const tx = await signer.sendTransaction({ to: opts.to, value })
  const rc = await tx.wait()
  if (!rc || rc.status !== 1) throw new Error('BNB send failed')
  return rc.hash
}

export async function fetchBtcTestnetBalance(address: string): Promise<BtcBalance | null> {
  return fetchBtcBalance(address, 'testnet')
}

export async function fetchBtcChainBalance(
  address: string,
  network: BtcNetwork = 'testnet',
): Promise<BtcBalance | null> {
  return fetchBtcBalance(address, network)
}
