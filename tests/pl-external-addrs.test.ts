import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

describe('needsOnChainBtcLink', () => {
  it('is true when local BTC exists and on-chain is empty', async () => {
    const { needsOnChainBtcLink } = await import('@/lib/pl-external-addrs')
    expect(needsOnChainBtcLink('miqBrMMrH3nz2cfHLj14ySukPGBJ5GwBpn', {})).toBe(true)
    expect(needsOnChainBtcLink('miqBrMMrH3nz2cfHLj14ySukPGBJ5GwBpn', undefined)).toBe(true)
  })
  it('is false when on-chain already matches', async () => {
    const { needsOnChainBtcLink } = await import('@/lib/pl-external-addrs')
    expect(
      needsOnChainBtcLink('miqBrMMrH3nz2cfHLj14ySukPGBJ5GwBpn', {
        btc: 'miqBrMMrH3nz2cfHLj14ySukPGBJ5GwBpn',
      }),
    ).toBe(false)
  })
  it('is true when on-chain differs from local', async () => {
    const { needsOnChainBtcLink } = await import('@/lib/pl-external-addrs')
    expect(
      needsOnChainBtcLink('miqBrMMrH3nz2cfHLj14ySukPGBJ5GwBpn', { btc: 'n1different' }),
    ).toBe(true)
  })
  it('is false without a local BTC address', async () => {
    const { needsOnChainBtcLink } = await import('@/lib/pl-external-addrs')
    expect(needsOnChainBtcLink('', {})).toBe(false)
    expect(needsOnChainBtcLink(null, {})).toBe(false)
  })
})

describe('publishBtcExternalAddrOnChain', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('@/lib/pl-wallet-sign')
  })

  it('signs and submits BTC-only set_external_addrs when on-chain empty', async () => {
    const sign = vi.fn(async () => ({
      tx_id: 'txid-btc',
      rawJson: '{"kind":"set_external_addrs"}',
      body: { kind: 'set_external_addrs', chain: 'btc', address: 'miqTest' },
    }))
    vi.doMock('@/lib/pl-wallet-sign', () => ({
      signPlSetExternalAddr: sign,
    }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { publishBtcExternalAddrOnChain } = await import('@/lib/pl-external-addrs')
    const out = await publishBtcExternalAddrOnChain({
      account: 'scott.reynolds.123',
      falconSecret: 'secret',
      sequence: 57,
      btcAddress: 'miqTest',
      networkKey: 'testnet',
      networkId: 2300,
      already: {},
    })
    expect(out.published).toBe(true)
    expect(out.txId).toBe('txid-btc')
    expect(out.nextSequence).toBe(58)
    expect(sign).toHaveBeenCalledOnce()
    expect(sign.mock.calls[0][0]).toMatchObject({
      account: 'scott.reynolds.123',
      chain: 'btc',
      address: 'miqTest',
      sequence: 57,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('skips submit when on-chain BTC already matches', async () => {
    const sign = vi.fn()
    vi.doMock('@/lib/pl-wallet-sign', () => ({
      signPlSetExternalAddr: sign,
    }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { publishBtcExternalAddrOnChain } = await import('@/lib/pl-external-addrs')
    const out = await publishBtcExternalAddrOnChain({
      account: 'scott.reynolds.123',
      falconSecret: 'secret',
      sequence: 57,
      btcAddress: 'miqTest',
      networkKey: 'testnet',
      already: { btc: 'miqTest' },
    })
    expect(out.published).toBe(false)
    expect(out.nextSequence).toBe(57)
    expect(sign).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
