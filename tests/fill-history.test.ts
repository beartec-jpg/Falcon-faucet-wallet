// Copyright (c) BEARTEC. All Rights Reserved.
import { describe, expect, it } from 'vitest'
import {
  FillHistoryStore,
  assignFillId,
  decodeHistoryCursor,
  encodeHistoryCursor,
  heightTimeFromTipStatus,
} from '@/lib/explorer-api/fill-history'

describe('fill history P2', () => {
  it('assigns distinct ids for identical fills at same height (multiplicity)', () => {
    const store = new FillHistoryStore()
    const twin = {
      height: 10,
      asset: 'BTC4',
      side: 'buy',
      price: 60000,
      base: 1000,
      quote: 60,
      taker: 'alice',
      maker: 'bob',
      maker_order: 1,
    }
    expect(store.ingest([twin, twin])).toBe(2)
    const page = store.page({ limit: 10 })
    expect(page.items).toHaveLength(2)
    expect(page.items[0].fill_id).not.toBe(page.items[1].fill_id)
    expect(page.items.map((x) => x.height_index).sort()).toEqual([0, 1])
    expect(page.coverage.is_full_archive).toBe(false)
  })

  it('opaque cursor resumes deterministically newest-first', () => {
    const store = new FillHistoryStore()
    for (let h = 1; h <= 5; h++) {
      store.ingest([{ height: h, asset: 'USDC', side: 'sell', price: 1, base: 1, quote: 1, taker: 'a', maker: 'b' }])
    }
    const first = store.page({ limit: 2 })
    expect(first.items.map((x) => x.height)).toEqual([5, 4])
    const cur = decodeHistoryCursor(first.next_cursor)
    expect(cur).toBe(first.items[1].fill_id)
    const second = store.page({ limit: 2, cursor: cur })
    expect(second.items.map((x) => x.height)).toEqual([3, 2])
  })

  it('restart dump/load retains records', () => {
    const a = new FillHistoryStore()
    a.ingest([{ height: 7, asset: 'ETH', side: 'buy', price: 2, base: 3, quote: 4, taker: 't', maker: 'm' }])
    const b = new FillHistoryStore()
    b.load(a.dump())
    expect(b.size).toBe(1)
    expect(b.page({ limit: 5 }).items[0].fill_id).toBe(a.page({ limit: 5 }).items[0].fill_id)
  })

  it('never Date(physics) for height time; UTC only when utc_committed', () => {
    const physics = 6_200_000_000
    const t = heightTimeFromTipStatus(
      { tip_sealed_at_ms: physics, tip_sealed_utc_ms: 0, tip_sealed_utc_quality: 'unavailable' },
      1_762_000_000_000,
    )
    expect(t.sealed_at).toBeNull()
    expect(t.sealed_at_ms).toBe(physics)
    expect(t.sealed_utc_source).toBe('none')
    const u = heightTimeFromTipStatus(
      { tip_sealed_at_ms: physics, tip_sealed_utc_ms: 1_762_000_111_000, tip_sealed_utc_quality: 'utc_committed' },
      1_762_000_200_000,
    )
    expect(u.sealed_utc).toBe(new Date(1_762_000_111_000).toISOString())
    expect(u.sealed_utc_source).toBe('signed_utc_v5')
  })

  it('encode/decode cursor round-trips', () => {
    const id = assignFillId(9, 0, 'abcdef123456')
    expect(decodeHistoryCursor(encodeHistoryCursor(id))).toBe(id)
    expect(decodeHistoryCursor('garbage')).toBeNull()
  })
})
