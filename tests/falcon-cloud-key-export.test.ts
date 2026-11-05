import { describe, it, expect } from 'vitest'
import { isExportAuthorized } from '@/lib/developers/export-auth'

const T = 'x'.repeat(40)

describe('falcon cloud key export auth', () => {
  it('accepts the exact bearer token', () => {
    expect(isExportAuthorized(`Bearer ${T}`, T)).toBe(true)
  })
  it('rejects missing/wrong/unconfigured', () => {
    expect(isExportAuthorized(null, T)).toBe(false)
    expect(isExportAuthorized(`Bearer ${T}y`, T)).toBe(false)
    expect(isExportAuthorized(T, T)).toBe(false)
    expect(isExportAuthorized(`Bearer ${T}`, null)).toBe(false)
  })
})
