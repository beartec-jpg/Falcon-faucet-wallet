import { describe, expect, it } from 'vitest'
import { eligibleSeats, nextInterval, nextRound, phaseAt, rotationCommittee, sealedRound } from '@/lib/netmap-consensus'
import { consensusFromStatus } from '@/lib/scan-snapshot'

const vals = ['falcon-node', 'scottspersonalnode', 'v1', 'v10', 'v11', 'v12', 'v13', 'v3', 'v6'].map((account) => ({ account, jailed: false, lottery_ready: true }))
  .concat([{ account: 'v2', jailed: true, lottery_ready: false }])
const base = {
  height: 531352,
  validators: vals as never,
  online_seats: vals.filter((v) => !v.jailed).map((v) => v.account),
  lottery_winner: 'v10',
  committee_size: 6,
  commit_need: 4,
  last_pack: { height: 531352, packer: 'v6', txs: 82 },
}

describe('consensus round', () => {
  it('passes the node committee fields through /api/scan (falcon2 status shape)', () => {
    const st = {
      sealed_committee: ['v6', 'v13', 'falcon-node', 'v1', 'v10', 'scottspersonalnode'],
      next_committee: ['v10', 'v6', 'v3', 'scottspersonalnode', 'v1', 'v11'],
      lottery_winner_next: 'v10',
      lottery_standby_next: 'v6',
      tip_cert_voters: 4,
      height_view_round: 0,
    }
    const { committee } = consensusFromStatus(st)
    expect(committee).toMatchObject({ next_packer: 'v10', standby: 'v6', cert_voters: 4 })
    const r = nextRound({ ...base, committee })
    expect(r).toMatchObject({ height: 531353, packer: 'v10', estimated: false, need: 4 })
    expect(r.voters).toEqual(st.next_committee)
    expect(sealedRound({ ...base, committee })).toMatchObject({ height: 531352, packer: 'v6', voters: st.sealed_committee })
    expect(consensusFromStatus({})).toEqual({})
  })

  it('falls back to a deterministic 6-of-9 rotation, flagged estimated', () => {
    const r = nextRound(base)
    expect(r.estimated).toBe(true)
    expect(r.voters).toHaveLength(6)
    expect(new Set(r.voters).size).toBe(6)
    expect(r.voters).not.toContain('v2')
    expect(nextRound(base)).toEqual(r)
    expect(nextRound({ ...base, height: base.height + 1 }).voters).not.toEqual(r.voters)
    expect(r.voters).toContain(r.packer)
    expect(eligibleSeats(base)).toHaveLength(9)
    expect(rotationCommittee(['a', 'b', 'c'], 4, 6)).toEqual(['b', 'c', 'a'])
  })

  it('phases and cadence', () => {
    expect(phaseAt(0, 3).phase).toBe('beam')
    expect(phaseAt(1.2, 3).phase).toBe('vote')
    expect(phaseAt(2.5, 3).phase).toBe('pulse')
    expect(phaseAt(9, 3)).toEqual({ phase: 'pulse', u: 1 })
    expect(nextInterval(0, 1, 2700)).toBe(2700)
    expect(nextInterval(2700, 2, 2700)).toBeCloseTo(2700 * 0.7 + 1350 * 0.3)
    expect(nextInterval(3000, 0, 1000)).toBe(3000)
    expect(nextInterval(0, 1, 100)).toBe(800)
  })
})
