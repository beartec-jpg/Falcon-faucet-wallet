import { describe, expect, it } from 'vitest'
import { parseSwapTx, recordSwap, swapsSince } from '@/lib/swap-log'

const tx = (body: string) => `{"tx":{"account":"dave","sequence":7,"body":${body}},"tx_id":"abc123","sig":"00"}`

describe('swap log', () => {
  it('parses swap_route txs only', () => {
    expect(parseSwapTx(tx('{"kind":"swap_route","token_in":"USDC","token_out":"FPL","amount_in":1500000,"min_out":1}'))).toEqual({ account: 'dave', token_in: 'USDC', amount_in: '1500000', tx_id: 'abc123' })
    expect(parseSwapTx(tx('{"kind":"pay"}'))).toBeNull()
    expect(parseSwapTx('not json')).toBeNull()
  })
  it('records in memory without a database', async () => {
    expect(await recordSwap(tx('{"kind":"swap_route","token_in":"FPL","token_out":"ETH","amount_in":5,"min_out":1}'), Date.parse('2026-10-14T00:00:00Z'))).toBe(true)
    expect(await swapsSince('2026-10-01')).toEqual([{ account: 'dave', token_in: 'FPL', amount_in: '5', day: '2026-10-14' }])
  })
})
