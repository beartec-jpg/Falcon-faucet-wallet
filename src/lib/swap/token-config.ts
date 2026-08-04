import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { NetworkKey } from '@/lib/networks'
import { serverRpcCall } from '@/lib/network-server'

export type TokenKind = 'iou' | 'mpt'

export interface StableTokenRef {
  symbol: string
  displaySymbol: string
  currency: string
  /** IOU issuer; for SPV MPT may be empty or bridge issuer account */
  issuer: string
  kind?: TokenKind
  /** Set for SPV light-client FBTC (and other MPT stables) */
  mptIssuanceId?: string
  /** Display decimals (8 for BTC sats-as-BTC) */
  decimals?: number
}

/** Canonical pool tab order on /pool */
export const POOL_PAIR_ORDER = ['F-USDC', 'FETH', 'FBNB', 'FBTC'] as const
export type PoolPairSymbol = (typeof POOL_PAIR_ORDER)[number]

function mapToken(t: {
  symbol: string
  currency: string
  issuer: string
  kind?: TokenKind
  mptIssuanceId?: string
  decimals?: number
}): StableTokenRef {
  const sym = t.symbol
  const displaySymbol =
    sym.startsWith('F-') || /^F[A-Z]{2,}$/.test(sym) ? sym : `F-${sym}`
  return {
    symbol: t.symbol,
    displaySymbol,
    currency: t.currency,
    issuer: t.issuer,
    kind: t.kind || 'iou',
    mptIssuanceId: t.mptIssuanceId,
    decimals: t.decimals,
  }
}

/** All configured Falcon stable / bridged IOUs (testnet-stables.json). */
export async function loadStableTokens(): Promise<StableTokenRef[]> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', 'config', 'testnet-stables.json'),
      'utf8',
    )
    const m = JSON.parse(raw) as {
      tokens?: Array<{ symbol: string; currency: string; issuer: string }>
    }
    const list = (m.tokens ?? []).filter((t) => t?.issuer && t?.currency)
    if (list.length) return list.map(mapToken)
  } catch {
    /* ignore */
  }
  return []
}

/**
 * Live SPV FBTC MPT issuance from BtcBridgeState (preferred over legacy IOU FBTC).
 */
export async function loadSpvFbtcToken(
  networkKey: NetworkKey = 'testnet',
): Promise<StableTokenRef | null> {
  try {
    const r = await serverRpcCall<{
      node?: {
        MPTokenIssuanceID?: string
        Account?: string
        error?: string
      }
      error?: string
    }>(
      networkKey,
      'ledger_entry',
      { btc_bridge_state: true, ledger_index: 'validated' },
      { allowError: true },
    )
    const id = r?.node?.MPTokenIssuanceID
    if (!id || r?.error) return null
    return {
      symbol: 'FBTC',
      displaySymbol: 'FBTC',
      currency: 'BTC',
      issuer: r.node?.Account || '',
      kind: 'mpt',
      mptIssuanceId: String(id).toUpperCase(),
      decimals: 8,
    }
  } catch {
    return null
  }
}

/** Default / first stable (backward compat — usually F-USDC). */
export async function loadStableToken(): Promise<StableTokenRef> {
  const all = await loadStableTokens()
  if (all[0]) return all[0]
  return { symbol: 'F-USDC', displaySymbol: 'F-USDC', currency: 'QUC', issuer: '' }
}

/**
 * Resolve a stable by symbol (FETH), currency (ETH), or currency+issuer.
 * FBTC prefers live SPV MPT issuance when bridge is active.
 */
export async function resolveStableToken(opts?: {
  symbol?: string | null
  currency?: string | null
  issuer?: string | null
  networkKey?: NetworkKey
}): Promise<StableTokenRef> {
  const symbol = opts?.symbol?.trim()
  const currency = opts?.currency?.trim()
  const issuer = opts?.issuer?.trim()
  const networkKey = opts?.networkKey || 'testnet'

  const wantsFbtc =
    (!!symbol && /^(f-?)?btc$/i.test(symbol)) ||
    (!!currency && currency.toUpperCase() === 'BTC')

  if (wantsFbtc) {
    const spv = await loadSpvFbtcToken(networkKey)
    if (spv?.mptIssuanceId) return spv
  }

  const all = await loadStableTokens()

  if (symbol) {
    const bySym = all.find(
      (t) =>
        t.symbol.toUpperCase() === symbol.toUpperCase() ||
        t.displaySymbol.toUpperCase() === symbol.toUpperCase(),
    )
    if (bySym) return bySym
  }

  if (currency && issuer) {
    const byBoth = all.find((t) => t.currency === currency && t.issuer === issuer)
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

/** Tokens in pool-tab order; FBTC uses SPV MPT when available. */
export async function loadPoolPairTokens(
  networkKey: NetworkKey = 'testnet',
): Promise<StableTokenRef[]> {
  const all = await loadStableTokens()
  const spv = await loadSpvFbtcToken(networkKey)
  const ordered: StableTokenRef[] = []
  for (const sym of POOL_PAIR_ORDER) {
    if (sym === 'FBTC' && spv?.mptIssuanceId) {
      ordered.push(spv)
      continue
    }
    const t = all.find(
      (x) =>
        x.symbol.toUpperCase() === sym || x.displaySymbol.toUpperCase() === sym,
    )
    if (t?.issuer || t?.mptIssuanceId) ordered.push(t)
  }
  for (const t of all) {
    if (t.symbol === 'FBTC' && spv?.mptIssuanceId) continue
    if (
      !ordered.some(
        (o) =>
          (o.mptIssuanceId && o.mptIssuanceId === t.mptIssuanceId) ||
          (o.issuer === t.issuer && o.currency === t.currency),
      )
    ) {
      ordered.push(t)
    }
  }
  return ordered
}

export function isMptToken(t: { kind?: TokenKind; mptIssuanceId?: string }): boolean {
  return t.kind === 'mpt' || !!t.mptIssuanceId
}
