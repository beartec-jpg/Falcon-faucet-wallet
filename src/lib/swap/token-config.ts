import { readFile } from 'node:fs/promises'
import path from 'node:path'

export interface StableTokenRef {
  symbol: string
  displaySymbol: string
  currency: string
  issuer: string
}

function mapToken(t: { symbol: string; currency: string; issuer: string }): StableTokenRef {
  return {
    symbol: t.symbol,
    displaySymbol: t.symbol.startsWith('F-') ? t.symbol : `F-${t.symbol}`,
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

export async function loadStableToken(): Promise<StableTokenRef> {
  const all = await loadStableTokens()
  if (all[0]) return all[0]
  return { symbol: 'F-USDC', displaySymbol: 'F-USDC', currency: 'QUC', issuer: '' }
}