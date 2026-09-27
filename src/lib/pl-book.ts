/** Per-pool LP and per-market lend lines for the Falcon wallet on network 2300. */

export type PlPoolLine = {
  id: string
  label: string
  assetLabel: string
  assetAmount: string
  fplAmount: string
  lpLabel: string
  sharePct: string
}

export type PlLendLine = {
  id: string
  label: string
  supplied: string
  sharePct: string
  debt: string
}

const DECIMALS: Record<string, number> = { FPL: 0, BTC: 8, ETH: 18, USDC: 6 }
const ORDER = ['USDC', 'ETH', 'BTC']

function digits(v: unknown): string {
  if (typeof v === 'string' && /^\d+$/.test(v)) return v.replace(/^0+(?=\d)/, '') || '0'
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v)
  return '0'
}

function assetLabel(asset: string): string {
  if (asset === 'USDC') return 'F-USDC'
  if (asset === 'ETH') return 'FETH'
  if (asset === 'BTC') return 'FBTC'
  return asset
}

function human(raw: string, asset: string): string {
  const d = DECIMALS[asset] ?? 0
  const show = asset === 'ETH' ? 8 : d
  const s = raw.replace(/^0+/, '') || '0'
  if (s === '0') return '0'
  if (d === 0) return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const pad = s.padStart(d + 1, '0')
  const whole = pad.slice(0, -d).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = pad.slice(-d).slice(0, show).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

function pctOf(part: string, whole: string): string {
  const p = BigInt(part || '0')
  const w = BigInt(whole || '0')
  if (p === 0n || w === 0n) return '0%'
  const bps = (p * 10000n) / w
  if (bps === 0n) return '<0.01%'
  const s = bps.toString().padStart(3, '0')
  const head = s.slice(0, -2)
  const frac = s.slice(-2).replace(/0+$/, '')
  return frac ? `${head}.${frac}%` : `${head}%`
}

function sliceOf(reserve: string, part: string, whole: string): string {
  const w = BigInt(whole || '0')
  if (w === 0n) return '0'
  return ((BigInt(reserve || '0') * BigInt(part || '0')) / w).toString()
}

function rank(asset: string): number {
  const i = ORDER.indexOf(asset)
  return i < 0 ? 9 : i
}

/** LP tokens from different pools are not one balance. One line per pool the account still holds. */
export function parsePlBook(body: {
  pools?: unknown[]
  markets?: unknown[]
  lp?: unknown[]
  positions?: unknown[]
}): { pools: PlPoolLine[]; lend: PlLendLine[] } {
  const pools = (body.pools ?? []).filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
  const lpRows = (body.lp ?? []).filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
  const markets = (body.markets ?? []).filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
  const positions = (body.positions ?? []).filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')

  const lines: PlPoolLine[] = []
  for (const row of lpRows) {
    const id = String(row.pool_id ?? '')
    if (!id || id === 'fpl-btc') continue
    const lp = digits(row.lp)
    if (lp === '0') continue
    const pool = pools.find((p) => String(p.id ?? '') === id)
    if (!pool) continue
    const a = String(pool.asset_a ?? '')
    const b = String(pool.asset_b ?? '')
    const fAsset = a === 'FPL' ? b : b === 'FPL' ? a : ''
    if (!fAsset || !(fAsset in DECIMALS) || fAsset === 'FPL') continue
    const fReserve = a === 'FPL' ? digits(pool.reserve_b) : digits(pool.reserve_a)
    const fplReserve = a === 'FPL' ? digits(pool.reserve_a) : digits(pool.reserve_b)
    const supply = digits(pool.lp_supply)
    lines.push({
      id,
      label: `${assetLabel(fAsset)} / FPL`,
      assetLabel: assetLabel(fAsset),
      assetAmount: human(sliceOf(fReserve, lp, supply), fAsset),
      fplAmount: human(sliceOf(fplReserve, lp, supply), 'FPL'),
      lpLabel: human(lp, 'FPL'),
      sharePct: pctOf(lp, supply),
    })
  }
  lines.sort((x, y) => rank(x.assetLabel === 'F-USDC' ? 'USDC' : x.assetLabel === 'FETH' ? 'ETH' : 'BTC') - rank(y.assetLabel === 'F-USDC' ? 'USDC' : y.assetLabel === 'FETH' ? 'ETH' : 'BTC'))

  const lend: PlLendLine[] = []
  for (const pos of positions) {
    const id = String(pos.market_id ?? '')
    const shares = digits(pos.shares)
    const debt = digits(pos.debt)
    if (shares === '0' && debt === '0') continue
    const market = markets.find((m) => String(m.id ?? '') === id)
    const asset = String(market?.asset ?? pos.asset ?? '')
    if (!asset || !(asset in DECIMALS)) continue
    const supply = digits(market?.total_supply)
    const issued = market?.share_supply == null || digits(market.share_supply) === '0' ? supply : digits(market.share_supply)
    const coins = issued === '0' || supply === '0' ? '0' : ((BigInt(shares) * BigInt(supply)) / BigInt(issued)).toString()
    lend.push({
      id: id || asset,
      label: assetLabel(asset),
      supplied: human(coins, asset),
      sharePct: pctOf(shares, issued),
      debt: debt === '0' ? '' : human(debt, asset),
    })
  }
  lend.sort((x, y) => rank(x.label === 'F-USDC' ? 'USDC' : x.label === 'FETH' ? 'ETH' : 'BTC') - rank(y.label === 'F-USDC' ? 'USDC' : y.label === 'FETH' ? 'ETH' : 'BTC'))

  return { pools: lines, lend }
}
