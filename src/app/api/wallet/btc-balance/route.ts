import { NextRequest, NextResponse } from 'next/server'

/**
 * Server-side Bitcoin balance (testnet/mainnet).
 * Proxies public explorers so the browser is not blocked by CSP/CORS.
 */

const EXPLORERS: Record<string, string[]> = {
  testnet: [
    'https://mempool.space/testnet4/api',
  ],
  mainnet: [
    'https://blockstream.info/api',
    'https://mempool.space/api',
  ],
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function isPlausibleP2pkh(addr: string, network: string): boolean {
  if (!addr) return false
  if (network === 'testnet' && /^tb1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{25,90}$/i.test(addr)) {
    return true
  }
  if (network === 'mainnet' && /^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{25,90}$/i.test(addr)) {
    return true
  }
  if (addr.length < 26 || addr.length > 35) return false
  for (const ch of addr) {
    if (!B58.includes(ch)) return false
  }
  if (network === 'testnet') return addr.startsWith('m') || addr.startsWith('n')
  return addr.startsWith('1')
}

export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get('address') || '').trim()
  const network = (req.nextUrl.searchParams.get('network') || 'testnet').toLowerCase()
  const net = network === 'mainnet' ? 'mainnet' : 'testnet'

  if (!isPlausibleP2pkh(address, net)) {
    return NextResponse.json({ error: 'Invalid Bitcoin address' }, { status: 400 })
  }

  let lastErr = 'explorer unavailable'
  for (const base of EXPLORERS[net]) {
    try {
      const r = await fetch(`${base}/address/${encodeURIComponent(address)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'falcon-wallet-btc/1.0' },
        cache: 'no-store',
        next: { revalidate: 0 },
      })
      if (!r.ok) {
        lastErr = `${base}: HTTP ${r.status}`
        continue
      }
      const j = (await r.json()) as {
        chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
        mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number }
      }
      const chainFunded = j.chain_stats?.funded_txo_sum ?? 0
      const chainSpent = j.chain_stats?.spent_txo_sum ?? 0
      const memFunded = j.mempool_stats?.funded_txo_sum ?? 0
      const memSpent = j.mempool_stats?.spent_txo_sum ?? 0
      const confirmedSats = chainFunded - chainSpent
      const unconfirmedSats = memFunded - memSpent
      const totalSats = confirmedSats + unconfirmedSats
      return NextResponse.json({
        address,
        network: net,
        confirmedSats,
        unconfirmedSats,
        totalSats,
        btc: (totalSats / 1e8).toFixed(8),
      })
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }

  return NextResponse.json({ error: lastErr }, { status: 502 })
}
