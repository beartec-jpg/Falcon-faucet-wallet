import { readFile } from 'node:fs/promises'
import path from 'node:path'

export interface StableTokenRef {
  symbol: string
  displaySymbol: string
  currency: string
  issuer: string
}

export async function loadStableToken(): Promise<StableTokenRef> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', 'config', 'testnet-stables.json'),
      'utf8',
    )
    const m = JSON.parse(raw) as { tokens?: Array<{ symbol: string; currency: string; issuer: string }> }
    const t = m.tokens?.[0]
    if (t?.issuer) {
      return {
        symbol: t.symbol,
        displaySymbol: 'F-USDC',
        currency: t.currency,
        issuer: t.issuer,
      }
    }
  } catch { /* ignore */ }
  return { symbol: 'F-USDC', displaySymbol: 'F-USDC', currency: 'QUC', issuer: '' }
}