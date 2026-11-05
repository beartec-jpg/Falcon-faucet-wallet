import { describe, expect, it } from 'vitest'
import { amountForPct, classifyBookResponse, cumulative, parseLevels, planLimitOrder, quoteOf, spreadOf } from '@/lib/pl-orderbook'

const base = { tipHeight: 806_000, openOrders: 0, fplBalance: 1_000_000n, assetBalance: 10_000_000n }

describe('pl-orderbook', () => {
  it('quote_of matches orderbook.rs', () => {
    expect(quoteOf(2_500_000n, 400n, 1_000_000n)).toBe(1000n)
  })
  it('plans a buy with FPL escrow', () => {
    const p = planLimitOrder({ ...base, asset: 'USDC', side: 'buy', price: '400', amount: '2.5' })
    expect(p).toMatchObject({ pair: 'USDC-FPL', priceRaw: '400', amountRaw: '2500000', escrowAsset: 'FPL', expiryHeight: null })
    expect(p.escrowRaw).toBe(1000n)
  })
  it('plans a sell with asset escrow and expiry', () => {
    const p = planLimitOrder({ ...base, asset: 'BTC4', side: 'sell', price: '100000', amount: '0.05', expiryBlocks: '100' })
    expect(p.amountRaw).toBe('5000000')
    expect(p.escrowAsset).toBe('BTC4')
    expect(p.expiryHeight).toBe('806100')
  })
  it('enforces min size, max open orders, balance', () => {
    expect(() => planLimitOrder({ ...base, asset: 'USDC', side: 'buy', price: '400', amount: '1' })).toThrow(/at least 1000/)
    expect(() => planLimitOrder({ ...base, openOrders: 32, asset: 'USDC', side: 'buy', price: '400', amount: '3' })).toThrow(/32 open orders/)
    expect(() => planLimitOrder({ ...base, fplBalance: 10n, asset: 'USDC', side: 'buy', price: '400', amount: '3' })).toThrow(/Not enough FPL/)
    expect(() => planLimitOrder({ ...base, asset: 'USDC', side: 'buy', price: '1.5', amount: '3' })).toThrow()
  })
  it('percent of balance', () => {
    expect(amountForPct('USDC', 'buy', 50, '400', 1000n, 0n)).toBe('1.25')
    expect(amountForPct('USDC', 'sell', 25, '', 0n, 10_000_000n)).toBe('2.5')
  })
  it('levels, depth and spread', () => {
    const bids = parseLevels([{ price: { raw: '99' }, amount: { raw: '5' }, total: { raw: '1' }, orders: 2 }, { price: { raw: '98' }, amount: { raw: '3' } }])
    const asks = parseLevels([{ price: { raw: '101' }, amount: { raw: '1' } }])
    expect(cumulative(bids)).toEqual([5n, 8n])
    expect(spreadOf(bids, asks)).toMatchObject({ bid: 99n, ask: 101n, spread: 2n, bps: 200 })
  })
  it('classifies API states', () => {
    expect(classifyBookResponse(501, { error: { code: 'not_implemented' } })).toBe('unavailable')
    expect(classifyBookResponse(200, { active: false })).toBe('inactive')
    expect(classifyBookResponse(200, { active: true, bids: [] })).toBe('live')
    expect(classifyBookResponse(502, {})).toBe('error')
  })
})
