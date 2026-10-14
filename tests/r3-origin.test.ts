import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

describe('requireBrowserOrigin (audit R-3)', () => {
  const prevVercel = process.env.VERCEL
  const prevAllowed = process.env.ALLOWED_ORIGINS
  beforeAll(() => {
    process.env.VERCEL = '1'
    delete process.env.ALLOWED_ORIGINS
  })
  afterAll(() => {
    if (prevVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = prevVercel
    if (prevAllowed === undefined) delete process.env.ALLOWED_ORIGINS
    else process.env.ALLOWED_ORIGINS = prevAllowed
  })

  function make(headers: Record<string, string>) {
    return new NextRequest('https://falcon-fpl.com/api/x', {
      method: 'POST',
      headers: { host: 'falcon-fpl.com', 'x-forwarded-proto': 'https', ...headers },
    })
  }

  it('allows matching Origin', async () => {
    const { requireBrowserOrigin } = await import('@/lib/origin')
    expect(requireBrowserOrigin(make({ origin: 'https://falcon-fpl.com' }))).toBe(true)
  })
  it('allows Sec-Fetch-Site same-origin without Origin', async () => {
    const { requireBrowserOrigin } = await import('@/lib/origin')
    expect(requireBrowserOrigin(make({ 'sec-fetch-site': 'same-origin' }))).toBe(true)
  })
  it('refuses bare requests and cross-site', async () => {
    const { requireBrowserOrigin } = await import('@/lib/origin')
    expect(requireBrowserOrigin(make({}))).toBe(false)
    expect(requireBrowserOrigin(make({ origin: 'https://evil.example' }))).toBe(false)
    expect(requireBrowserOrigin(make({ 'sec-fetch-site': 'cross-site' }))).toBe(false)
  })
})
