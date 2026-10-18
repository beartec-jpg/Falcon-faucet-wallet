import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = {
  GAME_FAUCET_MIN_SCORE: 500,
  GAME_GLOBAL_CLAIMS_PER_DAY: 0,
  arcadeUtcDay: () => '2026-10-18',
  countGlobalGameClaimsToday: vi.fn(async () => 0),
  finalizeGameClaim: vi.fn(async () => {}),
  consumeClaimProgress: vi.fn(async () => ({ ok: true, progress: 16 })),
  getBestScore: vi.fn(async () => 516),
  getClaimProgress: vi.fn(async () => ({ progress: 516 })),
  isGameSlug: () => true,
  refundClaimProgress: vi.fn(async () => {}),
  releaseGameClaim: vi.fn(async () => {}),
  reserveGameClaim: vi.fn(async () => ({
    ok: true,
    reservationId: 'r1',
    quota: { remainingGame: 8, remainingTotal: 8, claimsThisGameToday: 0, claimsTotalToday: 0 },
  })),
}
const sendFaucetDrip = vi.fn(async () => ({ ok: false, status: 503, error: 'Cannot reach Falcon Ledger node.' }))
const plFaucetDrip = vi.fn()

vi.mock('@/lib/arcade-store', () => store)
vi.mock('@/lib/faucet-pay', () => ({ sendFaucetDrip }))
vi.mock('@/lib/pl-faucet-drip', () => ({ plFaucetDrip, PL_DRIP: 2000 }))
vi.mock('@/lib/origin', () => ({ isOriginAllowed: () => true }))
vi.mock('@/lib/faucet-quota', () => ({
  faucetUtcDay: () => '2026-10-18',
  hashIp: async () => 'h',
  logFaucetClaim: async () => {},
  peekFaucetQuota: async () => ({ success: true }),
  consumeFaucetQuota: async () => {},
}))

function req() {
  return new Request('https://falcon-fpl.com/api/arcade/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify({ account: 'scott', game: 'falcon-flight', network: 'testnet' }),
  }) as never
}

describe('arcade claim on Falcon PL 2300', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pays through the PL drip, not the legacy xrpld RPC path', async () => {
    plFaucetDrip.mockResolvedValueOnce({ ok: true, txId: 'abc', amount: 2000 })
    const { POST } = await import('@/app/api/arcade/claim/route')
    const res = await POST(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.txHash).toBe('abc')
    expect(plFaucetDrip).toHaveBeenCalledWith('scott', expect.any(Number))
    expect(sendFaucetDrip).not.toHaveBeenCalled()
    expect(store.refundClaimProgress).not.toHaveBeenCalled()
  })

  it('refunds progress and surfaces the specific error when the drip fails', async () => {
    plFaucetDrip.mockResolvedValueOnce({ ok: false, status: 503, reason: 'pl_unreachable', error: 'Cannot reach Falcon PL. Try again shortly.' })
    const { POST } = await import('@/app/api/arcade/claim/route')
    const res = await POST(req())
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body).toMatchObject({ reason: 'pl_unreachable', refunded: true })
    expect(store.refundClaimProgress).toHaveBeenCalledWith(expect.objectContaining({ amount: 500, address: 'scott' }))
    expect(store.releaseGameClaim).toHaveBeenCalledWith('r1')
  })
})
