/**
 * Read-only native balances for multi-chain deposit wallets.
 */

export async function fetchBnbTestnetBalance(address: string): Promise<string | null> {
  const rpcs = [
    'https://bsc-testnet-rpc.publicnode.com',
    'https://data-seed-prebsc-1-s1.binance.org:8545',
  ]
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
  })
  for (const url of rpcs) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!r.ok) continue
      const j = (await r.json()) as { result?: string }
      if (!j.result) continue
      const wei = BigInt(j.result)
      const whole = Number(wei) / 1e18
      return whole.toFixed(6)
    } catch {
      /* try next */
    }
  }
  return null
}
