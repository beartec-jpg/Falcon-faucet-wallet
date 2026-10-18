import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ getSql: () => null, isDbConfigured: () => false }))

describe('arcade game IP bucket', () => {
  it('uses game limits, not the main faucet 1h cooldown', async () => {
    const q = await import('@/lib/faucet-quota')
    expect(q.limitsFromKey('game:testnet:ip:1.2.3.4')).toEqual({
      dayCap: q.GAME_IP_CLAIMS_PER_DAY,
      cooldown: q.GAME_IP_COOLDOWN_SECONDS,
    })
    expect(q.limitsFromKey('testnet:ip:1.2.3.4').cooldown).toBe(q.FAUCET_COOLDOWN_SECONDS)
    expect(q.GAME_IP_COOLDOWN_SECONDS).toBeLessThan(60)
    expect(q.GAME_IP_CLAIMS_PER_DAY).toBeGreaterThanOrEqual(8)
  })

  it('a claim in one game does not block a claim in another game minutes later', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T15:07:45Z'))
    const q = await import('@/lib/faucet-quota')
    const key = 'game:testnet:ip:9.9.9.9'
    expect((await q.peekFaucetQuota(key)).success).toBe(true)
    await q.consumeFaucetQuota(key)
    vi.setSystemTime(new Date('2026-10-18T15:09:18Z'))
    expect((await q.peekFaucetQuota(key)).success).toBe(true)
    // main faucet bucket for the same IP is untouched and still enforces its own cooldown
    await q.consumeFaucetQuota('testnet:ip:9.9.9.9')
    expect((await q.peekFaucetQuota('testnet:ip:9.9.9.9')).reason).toBe('cooldown')
    vi.useRealTimers()
  })
})
