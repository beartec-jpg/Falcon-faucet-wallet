/**
 * Classic XRPL HTTP/JSON-RPC helpers with no `xrpl` package import.
 * Next 14 collect page data `require()`s API routes; `xrpl` is ESM-only.
 */

export type XrplClassicNetwork = 'testnet' | 'mainnet'

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

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

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
