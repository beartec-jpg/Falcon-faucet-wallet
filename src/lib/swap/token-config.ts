import { readFile } from 'node:fs/promises'
import path from 'node:path'

export interface StableTokenRef {
  symbol: string
  displaySymbol: string
  currency: string
  issuer: string
}

/** Canonical pool tab order on /pool */
export const POOL_PAIR_ORDER = ['F-USDC', 'FETH', 'FBNB', 'FBTC'] as const
export type PoolPairSymbol = (typeof POOL_PAIR_ORDER)[number]

function mapToken(t: { symbol: string; currency: string; issuer: string }): StableTokenRef {
  const sym = t.symbol
  const displaySymbol =
    sym.startsWith('F-') || /^F[A-Z]{2,}$/.test(sym) ? sym : `F-${sym}`
  return {
    symbol: t.symbol,
    displaySymbol,
    currency: t.currency,
    issuer: t.issuer,
  }
}

/** All configured Falcon stable / bridged IOUs (testnet-stables.json). */
export async function loadStableTokens(): Promise<StableTokenRef[]> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', 'config', 'testnet-stables.json'),
      'utf8',
    )
    const m = JSON.parse(raw) as { tokens?: Array<{ symbol: string; currency: string; issuer: string }> }
    const list = (m.tokens ?? []).filter((t) => t?.issuer && t?.currency)
    if (list.length) return list.map(mapToken)
  } catch { /* ignore */ }
  return []
}

/** Default / first stable (backward compat — usually F-USDC). */
export async function loadStableToken(): Promise<StableTokenRef> {
  const all = await loadStableTokens()
  if (all[0]) return all[0]
  return { symbol: 'F-USDC', displaySymbol: 'F-USDC', currency: 'QUC', issuer: '' }
}

/**
 * Resolve a stable by symbol (FETH), currency (ETH), or currency+issuer.
 * Defaults to first configured token when no selector is provided.
 */
export async function resolveStableToken(opts?: {
  symbol?: string | null
  currency?: string | null
  issuer?: string | null
}): Promise<StableTokenRef> {
  const all = await loadStableTokens()
  const symbol = opts?.symbol?.trim()
  const currency = opts?.currency?.trim()
  const issuer = opts?.issuer?.trim()

  if (symbol) {
    const bySym = all.find(
      (t) =>
        t.symbol.toUpperCase() === symbol.toUpperCase() ||
        t.displaySymbol.toUpperCase() === symbol.toUpperCase(),
    )
    if (bySym) return bySym
  }

  if (currency && issuer) {
    const byBoth = all.find(
      (t) => t.currency === currency && t.issuer === issuer,
    )
    if (byBoth) return byBoth
  }

  if (currency) {
    const byCur = all.find((t) => t.currency === currency)
    if (byCur) return byCur
  }

  if (issuer) {
    const byIss = all.find((t) => t.issuer === issuer)
    if (byIss) return byIss
  }

  return all[0] ?? { symbol: 'F-USDC', displaySymbol: 'F-USDC', currency: 'QUC', issuer: '' }
}

/** Tokens in pool-tab order (only those present in config). */
export async function loadPoolPairTokens(): Promise<StableTokenRef[]> {
  const all = await loadStableTokens()
  const ordered: StableTokenRef[] = []
  for (const sym of POOL_PAIR_ORDER) {
    const t = all.find(
      (x) =>
        x.symbol.toUpperCase() === sym ||
        x.displaySymbol.toUpperCase() === sym,
    )
    if (t?.issuer) ordered.push(t)
  }
  // Any extra configured tokens not in the canonical list
  for (const t of all) {
    if (!ordered.some((o) => o.issuer === t.issuer && o.currency === t.currency)) {
      ordered.push(t)
    }
  }
  return ordered
}
