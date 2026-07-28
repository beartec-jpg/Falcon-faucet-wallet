import { NextRequest, NextResponse } from 'next/server'
import { formatUnits } from 'ethers'

/**
 * Server-side BSC testnet native balance.
 * Avoids browser CSP / flaky public RPC from the client.
 */

const BSC_TESTNET_RPCS = [
  'https://bsc-testnet-rpc.publicnode.com',
  'https://data-seed-prebsc-1-s1.binance.org:8545',
  'https://bsc-testnet.drpc.org',
  'https://rpc.ankr.com/bsc_testnet_chapel',
] as const

export async function GET(req: NextRequest) {
  const address = (req.nextUrl.searchParams.get('address') || '').trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid EVM address' }, { status: 400 })
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
  })

  let lastErr = 'BSC testnet RPC unavailable'
  for (const url of BSC_TESTNET_RPCS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'falcon-wallet-bnb/1.0',
        },
        body,
        cache: 'no-store',
      })
      if (!r.ok) {
        lastErr = `${url}: HTTP ${r.status}`
        continue
      }
      const j = (await r.json()) as { result?: string; error?: { message?: string } }
      if (j.error?.message) {
        lastErr = j.error.message
        continue
      }
      if (!j.result) {
        lastErr = 'empty result'
        continue
      }
      const wei = BigInt(j.result)
      const bnb = formatUnits(wei, 18)
      return NextResponse.json({
        address,
        network: 'bsc-testnet',
        chainId: 97,
        wei: j.result,
        bnb,
      })
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }

  return NextResponse.json({ error: lastErr }, { status: 502 })
}
