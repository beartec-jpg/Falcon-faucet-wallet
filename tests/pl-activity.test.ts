import { describe, expect, it } from 'vitest'
import { assetLabel, buildPlActivity, estimateHeightMs, formatAssetAmount, PL_BLOCK_MS_ESTIMATE } from '@/lib/pl-activity'

const NOW = Date.UTC(2026, 10, 5, 5, 40)
const RIPPLE = 946_684_800

describe('formatAssetAmount', () => {
  it('applies per-asset decimals', () => {
    expect(formatAssetAmount('150000000', 'USDC')).toBe('150')
    expect(formatAssetAmount('14999998982874697', 'ETH')).toBe('0.01499999')
    expect(formatAssetAmount('99924', 'BTC4')).toBe('0.00099924')
    expect(formatAssetAmount('100000000', 'BTC')).toBe('1')
    expect(formatAssetAmount('18805906', 'FPL')).toBe('18,805,906')
  })
  it('labels assets', () => {
    expect([assetLabel('USDC'), assetLabel('ETH'), assetLabel('BTC4'), assetLabel('FPL')]).toEqual(['F-USDC', 'FETH', 'FBTC', 'FPL'])
  })
})

describe('estimateHeightMs', () => {
  it('uses tip distance, not sealed_at_ms', () => {
    expect(estimateHeightMs(808_379, 808_400, NOW)).toBe(NOW - 21 * PL_BLOCK_MS_ESTIMATE)
    expect(estimateHeightMs(808_379, 0, NOW)).toBeUndefined()
  })
})

describe('buildPlActivity', () => {
  const rows = buildPlActivity({
    self: 'scott.reynolds.123',
    tip: 808_400,
    nowMs: NOW,
    recentTxs: [
      { tx_id: 'aa', height: 808_357, kind: 'asset_pay', asset: 'USDC', amount: '150000000', account: 'scott.reynolds.123', destination: 'dave', sealed_at_ms: 6_200_000_000 },
      { tx_id: 'bb', height: 808_300, kind: 'place_limit_order', amount: 0, account: 'scott.reynolds.123' },
      { tx_id: 'cc', height: 808_200, kind: 'tx', amount: 0, account: 'scott.reynolds.123' },
    ],
    fills: [
      { height: 808_379, asset: 'USDC', side: 'sell', price: 82, base: '60000000', quote: 4920, taker: 'dave', maker: 'scott.reynolds.123', maker_order: 0 },
      { height: 808_379, asset: 'USDC', side: 'sell', price: 82, base: '9078369', quote: 744, taker: 'dave', maker: 'amm:USDC', maker_order: null },
      { height: 808_390, asset: 'USDC', side: 'buy', price: 80, base: '1000000', quote: 80, taker: 'scott.reynolds.123', maker: 'amm:USDC', maker_order: null },
    ],
    orders: [{ id: 7, pair: 'USDC-FPL', side: 'buy', price: 80, amount: '20000000', remaining: '5000000', placed_height: 808_395 }],
  })

  it('drops fills that do not involve the account and sorts newest first', () => {
    expect(rows.map((r) => r.hash)).toEqual(['order:7', 'fill:808390:USDC:amm:2', 'fill:808379:USDC:0:0', 'aa', 'bb', 'cc'])
  })
  it('formats asset_pay and dates it from height', () => {
    const r = rows.find((x) => x.hash === 'aa')!
    expect(r.amount).toBe('150')
    expect(r.amountAsset).toBe('F-USDC')
    expect(r.date).toBe(Math.floor((NOW - 43 * PL_BLOCK_MS_ESTIMATE) / 1000) - RIPPLE)
  })
  it('labels maker fills, swaps, orders and other kinds', () => {
    const fill = rows.find((x) => x.hash === 'fill:808379:USDC:0:0')!
    expect(fill.label).toBe('Limit buy F-USDC @ 82 filled by')
    expect(fill.party).toBe('dave')
    expect(fill.amountLabel).toBe('+60 F-USDC · −4,920 FPL')
    const swap = rows.find((x) => x.hash.startsWith('fill:808390'))!
    expect(swap.type).toBe('Swap')
    expect(swap.amountLabel).toBe('+1 F-USDC · −80 FPL')
    expect(rows[0].label).toBe('Open limit buy #7 @ 80')
    expect(rows[0].party).toBe('USDC-FPL · 5 of 20 F-USDC')
    expect(rows.find((x) => x.hash === 'bb')!.label).toBe('Placed limit order')
    expect(rows.find((x) => x.hash === 'cc')!.label).toBe('Chain transaction')
  })
})
