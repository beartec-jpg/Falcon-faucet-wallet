import { describe, expect, it } from 'vitest'
import { destLockLcWaitText } from '@/lib/dest-lock-pending'

describe('destLockLcWaitText', () => {
  it('says syncing (not block 0) when the light client has no execution head', () => {
    const t = destLockLcWaitText({ depositBlock: 11946768, lcExecution: 0 })
    expect(t).toContain('Light client syncing')
    expect(t).not.toContain('block 0')
  })
  it('treats a missing lc_execution as syncing', () => {
    expect(destLockLcWaitText({ depositBlock: 100 })).toContain('Light client syncing')
  })
  it('shows the block and blocks remaining while behind', () => {
    const t = destLockLcWaitText({ depositBlock: 11946768, lcExecution: 11921706, waitingBlocks: 25062 })
    expect(t).toContain('Light client is at block 11,921,706')
    expect(t).toContain('25,062 blocks remaining')
  })
  it('derives blocks remaining when waiting_blocks is absent', () => {
    expect(destLockLcWaitText({ depositBlock: 110, lcExecution: 100 })).toContain('10 blocks remaining')
  })
  it('returns null once the light client has passed the deposit', () => {
    expect(destLockLcWaitText({ depositBlock: 100, lcExecution: 200 })).toBeNull()
    expect(destLockLcWaitText({ lcExecution: 0 })).toBeNull()
  })
})
