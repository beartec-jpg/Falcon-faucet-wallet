/**
 * Read-only native balances + simple sends for multi-chain deposit wallets.
 * BNB send signs in-browser and broadcasts via same-origin /api/wallet/bnb-rpc
 * so CSP / public RPC failures do not surface as bare "Failed to fetch".
 */

import {
  JsonRpcProvider,
  Wallet,
  parseUnits,
  formatUnits,
  type TransactionLike,
} from 'ethers'
import { fetchBtcBalance, type BtcBalance, type BtcNetwork } from '@/lib/btc-client'

export type { BtcBalance }

const BSC_TESTNET_RPCS = [
  'https://bsc-testnet-rpc.publicnode.com',
  'https://data-seed-prebsc-1-s1.binance.org:8545',
  'https://bsc-testnet.drpc.org',
] as const

const BSC_TESTNET_CHAIN_ID = 97

/** JSON-RPC via Next API proxy (browser-safe). Accepts ethers-style JSON-RPC envelope. */
async function bnbRpcProxy<T = string>(method: string, params: unknown[] = []): Promise<T> {
  let r: Response
  try {
    r = await fetch('/api/wallet/bnb-rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      cache: 'no-store',
    })
  } catch {
    throw new Error(
      'Could not reach wallet API (network offline?). Check connection and try again.',
    )
  }
  const j = (await r.json()) as {
    result?: T
    error?: string | { message?: string }
  }
  const errMsg =
    typeof j.error === 'string' ? j.error : j.error?.message
  if (!r.ok && errMsg) {
    throw new Error(errMsg)
  }
  if (j.error && typeof j.error === 'object' && j.error.message) {
    throw new Error(j.error.message)
  }
  if (j.result === undefined || j.result === null) {
    throw new Error(errMsg || `BSC RPC empty result for ${method}`)
  }
  return j.result
}

export async function fetchBnbTestnetBalance(address: string): Promise<string | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null

  // Prefer dedicated balance route
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

  // Proxy eth_getBalance
  try {
    const hex = await bnbRpcProxy<string>('eth_getBalance', [address, 'latest'])
    return formatUnits(BigInt(hex), 18)
  } catch {
    /* fall through to direct */
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
      return formatUnits(BigInt(j.result), 18)
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

/**
 * Send native BNB on BSC testnet (same 0x key as ETH).
 * Signs locally; prefers same-origin broadcast so browsers with CSP still work.
 */
export async function sendBnbTestnet(opts: {
  evmPrivateKey: string
  to: string
  amountBnb: string
}): Promise<string> {
  const pk = opts.evmPrivateKey.startsWith('0x') ? opts.evmPrivateKey : `0x${opts.evmPrivateKey}`
  const to = opts.to.trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
    throw new Error('Invalid destination address (0x…)')
  }

  const value = parseUnits(opts.amountBnb, 18)
  if (value <= 0n) throw new Error('Amount must be greater than zero')

  // ── Preferred path: proxy nonce/gas + raw broadcast ───────────────────────
  try {
    const wallet = new Wallet(pk)
    const from = wallet.address

    const balHex = await bnbRpcProxy<string>('eth_getBalance', [from, 'latest'])
    const bal = BigInt(balHex)
    if (value > bal) {
      throw new Error(
        `Amount exceeds BNB balance (${formatUnits(bal, 18)} available)`,
      )
    }

    const nonceHex = await bnbRpcProxy<string>('eth_getTransactionCount', [from, 'pending'])
    const nonce = Number.parseInt(nonceHex, 16)
    const gasPriceHex = await bnbRpcProxy<string>('eth_gasPrice', [])
    let gasPrice = BigInt(gasPriceHex)
    // Slight bump for flaky testnet inclusion
    gasPrice = (gasPrice * 12n) / 10n
    if (gasPrice === 0n) gasPrice = 10_000_000_000n // 10 gwei fallback

    const gasLimit = 21_000n
    const fee = gasPrice * gasLimit
    if (value + fee > bal) {
      throw new Error(
        `Insufficient BNB for amount + gas (need ~${formatUnits(value + fee, 18)}, have ${formatUnits(bal, 18)})`,
      )
    }

    const unsigned: TransactionLike = {
      type: 0,
      to,
      value,
      nonce,
      gasLimit,
      gasPrice,
      chainId: BSC_TESTNET_CHAIN_ID,
      data: '0x',
    }
    const raw = await wallet.signTransaction(unsigned)
    const hash = await bnbRpcProxy<string>('eth_sendRawTransaction', [raw])
    if (!hash || !hash.startsWith('0x')) {
      throw new Error('Broadcast returned no transaction hash')
    }

    // Best-effort wait for inclusion via proxy (don't fail send if slow)
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      try {
        const rc = await bnbRpcProxy<{ status?: string } | null>(
          'eth_getTransactionReceipt',
          [hash],
        )
        if (rc && rc.status != null) {
          if (rc.status === '0x0') throw new Error('BNB send reverted on-chain')
          return hash
        }
      } catch (e) {
        if (e instanceof Error && /reverted/i.test(e.message)) throw e
      }
      await new Promise((r) => setTimeout(r, 2500))
    }
    // Submitted even if receipt lag — hash is enough for UI
    return hash
  } catch (proxyErr) {
    // If proxy path failed on business logic, don't hide the message
    if (
      proxyErr instanceof Error &&
      (/exceeds|Insufficient|Invalid|reverted|Broadcast/i.test(proxyErr.message) ||
        !/fetch|network|RPC|API|unavailable|offline/i.test(proxyErr.message))
    ) {
      // fall through only for transport-ish errors; rethrow clear user errors
      if (!/fetch|Failed to fetch|network|RPC proxy|unavailable|offline|Could not reach/i.test(proxyErr.message)) {
        throw proxyErr
      }
    }

    // ── Fallback: direct ethers provider (dev / permissive CSP) ─────────────
    try {
      const p = await resolveBscProvider()
      const signer = new Wallet(pk, p)
      const bal = await p.getBalance(signer.address)
      if (value > bal) {
        throw new Error(
          `Amount exceeds BNB balance (${formatUnits(bal, 18)} available)`,
        )
      }
      const tx = await signer.sendTransaction({ to, value })
      const rc = await tx.wait()
      if (!rc || rc.status !== 1) throw new Error('BNB send failed')
      return rc.hash
    } catch (directErr) {
      const a = proxyErr instanceof Error ? proxyErr.message : String(proxyErr)
      const b = directErr instanceof Error ? directErr.message : String(directErr)
      if (/Failed to fetch|NetworkError|Load failed/i.test(b) || /Failed to fetch/i.test(a)) {
        throw new Error(
          'Could not reach BSC testnet. Hard-refresh and try again. If it persists, the wallet API proxy may be down.',
        )
      }
      throw directErr instanceof Error ? directErr : new Error(b || a)
    }
  }
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
