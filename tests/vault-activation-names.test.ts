import { describe, expect, it, vi, beforeAll } from 'vitest'
import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import {
  canonicalNameInput,
  hotWalletNameError,
  isDoubleVaultName,
  isVaultSuffixName,
  linkedVaultName,
  plNameHint,
  reserveNameError,
  VAULT_SUFFIX_NAME_ERROR,
} from '@/lib/pl-names'
import {
  falconRawPub,
  hotWalletCostFpl,
  isDestinationKeyBound,
  isOwnLinkedVault,
  isPayToKeyUnsupported,
  keyCommitHash,
  vaultActivationNeedFpl,
  vaultFundShortfall,
} from '@/lib/vault-activation'

beforeAll(() => {
  process.env.VERCEL = '1'
  delete process.env.KV_REST_API_URL
  delete process.env.UPSTASH_REDIS_REST_URL
})

describe('hot wallet names cannot end in .vault', () => {
  it.each(['scott.vault', 'SCOTT.VAULT', '  scott.Vault  ', 'a.b.vault', 'ｓｃｏｔｔ.ｖａｕｌｔ'])(
    'rejects %j',
    (n) => {
      expect(isVaultSuffixName(n)).toBe(true)
      expect(hotWalletNameError(n)).toBe(VAULT_SUFFIX_NAME_ERROR)
      expect(plNameHint(n)).toBe(VAULT_SUFFIX_NAME_ERROR)
      expect(reserveNameError(n, 'wallet')).toBe(VAULT_SUFFIX_NAME_ERROR)
    },
  )
  it.each(['scott', 'scott.reynolds.123', 'vault.scott', 'myvault', 'scott.vaults'])('allows %j', (n) => {
    expect(isVaultSuffixName(n)).toBe(false)
    expect(hotWalletNameError(n)).toBeNull()
    expect(reserveNameError(n, 'wallet')).toBeNull()
  })
  it('NFKC + trim + lowercase', () => {
    expect(canonicalNameInput('  ＡＢＣ ')).toBe('abc')
  })
  it('vault purpose may reserve x.vault but never x.vault.vault', () => {
    expect(reserveNameError('scott.reynolds.123.vault', 'vault')).toBeNull()
    expect(isDoubleVaultName('scott.vault.vault')).toBe(true)
    expect(reserveNameError('scott.vault.vault', 'vault')).toBe(VAULT_SUFFIX_NAME_ERROR)
  })
  it('linkedVaultName never doubles the suffix', () => {
    expect(linkedVaultName('scott.reynolds.123')).toBe('scott.reynolds.123.vault')
    expect(linkedVaultName('scott.vault')).toBeNull()
  })
  it('server reserve route refuses a .vault wallet name', async () => {
    const { POST } = await import('@/app/api/wallet/name/route')
    const r = await POST(
      new NextRequest('https://falcon-fpl.com/api/wallet/name', {
        method: 'POST',
        body: JSON.stringify({ action: 'reserve', name: ' Scott.VAULT ', publicKey: 'ab' }),
        headers: { host: 'falcon-fpl.com', 'x-forwarded-proto': 'https', 'content-type': 'application/json', origin: 'https://falcon-fpl.com' },
      }),
    )
    expect(r.status).toBe(400)
    const j = (await r.json()) as { error?: string; code?: string }
    expect(j.code).toBe('name_vault_suffix')
    expect(j.error).toContain('.vault')
  })
})

describe('vault activation from the hot wallet', () => {
  it('funding amounts', () => {
    expect(vaultActivationNeedFpl(100)).toBe(104)
    expect(vaultFundShortfall(100, 0)).toBe(104)
    expect(vaultFundShortfall(100, 50)).toBe(54)
    expect(vaultFundShortfall(100, 500)).toBe(0)
    expect(hotWalletCostFpl(104)).toBe(106)
  })
  it('key commit hash = sha256(raw 897-byte key), 0xFB blob hashes the same', async () => {
    const raw = Buffer.alloc(897, 7)
    const want = createHash('sha256').update(raw).digest('hex')
    expect(await keyCommitHash(raw.toString('hex'))).toBe(want)
    const blob = Buffer.concat([Buffer.from([0xfb]), raw]).toString('hex').toUpperCase()
    expect(await keyCommitHash(blob)).toBe(want)
    expect(falconRawPub(blob).length).toBe(897)
    expect(() => falconRawPub('abcd')).toThrow()
  })
  it('fallback classification', () => {
    expect(isPayToKeyUnsupported('pay_to_key: not active before the key-bind height')).toBe(true)
    expect(isPayToKeyUnsupported('bad tx json: unknown variant `pay_to_key`, expected one of ...')).toBe(true)
    expect(isPayToKeyUnsupported('insufficient balance')).toBe(false)
    expect(isPayToKeyUnsupported('key bind: account has no key')).toBe(false)
    expect(isDestinationKeyBound('pay_to_key: destination already has a key')).toBe(true)
  })
  it('own linked vault detection', () => {
    const v = { accountName: 'scott.reynolds.123.vault', payoutAddress: 'scott.reynolds.123', publicKey: 'FB00' }
    const vCustomPayout = { accountName: 'scott.reynolds.123.vault', payoutAddress: 'cold.payout.account', publicKey: 'FB00' }
    expect(isOwnLinkedVault('Scott.Reynolds.123.vault', 'scott.reynolds.123', v, 'scott.reynolds.123.vault')).toBe(true)
    expect(isOwnLinkedVault('Scott.Reynolds.123.vault', 'scott.reynolds.123', vCustomPayout, 'scott.reynolds.123.vault')).toBe(true)
    expect(isOwnLinkedVault('other.vault', 'scott.reynolds.123', v, 'scott.reynolds.123.vault')).toBe(false)
    expect(isOwnLinkedVault('scott.reynolds.123.vault', 'mallory', v, 'mallory.vault')).toBe(false)
    expect(isOwnLinkedVault('scott.reynolds.123.vault', 'scott.reynolds.123', null, 'scott.reynolds.123.vault')).toBe(false)
  })
  it('pay_to_key signs the serde body {"kind":"pay_to_key","key_hash":…}', async () => {
    vi.resetModules()
    const seen: string[] = []
    vi.doMock('@/lib/falcon-wasm', () => ({
      getFalcon512: async () => ({
        sign: (m: Uint8Array) => {
          seen.push(new TextDecoder().decode(m))
          return new Uint8Array([1, 2])
        },
      }),
    }))
    vi.doMock('@/lib/falcon-keys', () => ({
      decodeFalconSecret: () => ({ pubBlob: new Uint8Array([0xfb, 0xaa]), secretKey: new Uint8Array([9]) }),
      bytesToHex: (b: Uint8Array) => Buffer.from(b).toString('hex'),
      zeroize: (b: Uint8Array) => b.fill(0),
    }))
    const { signPlPayToKey } = await import('@/lib/pl-wallet-sign')
    const h = 'a'.repeat(64)
    const tx = await signPlPayToKey({
      account: 'scott.reynolds.123',
      destination: 'scott.reynolds.123.vault',
      amount: 104,
      keyHash: h,
      sequence: 5,
      falconSecret: 'x',
    })
    expect(seen[0]).toBe(
      `pl-tx:v2|scott.reynolds.123|5|scott.reynolds.123.vault|104|2|2300|{"kind":"pay_to_key","key_hash":"${h}"}`,
    )
    expect(tx.body).toEqual({ kind: 'pay_to_key', key_hash: h })
    await expect(
      signPlPayToKey({ account: 'a', destination: 'b', amount: 1, keyHash: 'XYZ', sequence: 0, falconSecret: 'x' }),
    ).rejects.toThrow()
    vi.doUnmock('@/lib/falcon-wasm')
    vi.doUnmock('@/lib/falcon-keys')
  })
  it('SetExternalAddr signs {"kind":"SetExternalAddr","chain":…,"address":…} with destination="" and amount=0', async () => {
    vi.resetModules()
    const seen: string[] = []
    vi.doMock('@/lib/falcon-wasm', () => ({
      getFalcon512: async () => ({
        sign: (m: Uint8Array) => {
          seen.push(new TextDecoder().decode(m))
          return new Uint8Array([1, 2])
        },
      }),
    }))
    vi.doMock('@/lib/falcon-keys', () => ({
      decodeFalconSecret: () => ({ pubBlob: new Uint8Array([0xfb, 0xaa]), secretKey: new Uint8Array([9]) }),
      bytesToHex: (b: Uint8Array) => Buffer.from(b).toString('hex'),
      zeroize: (b: Uint8Array) => b.fill(0),
    }))
    const { signPlSetExternalAddr } = await import('@/lib/pl-wallet-sign')
    const tx = await signPlSetExternalAddr({
      account: 'scott.reynolds.123',
      chain: 'BTC',
      address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
      sequence: 7,
      falconSecret: 'x',
    })
    expect(seen[0]).toBe(
      'pl-tx:v2|scott.reynolds.123|7||0|2|2300|{"kind":"SetExternalAddr","chain":"btc","address":"tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"}',
    )
    expect(tx.body).toEqual({
      kind: 'SetExternalAddr',
      chain: 'btc',
      address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    })
    vi.doUnmock('@/lib/falcon-wasm')
    vi.doUnmock('@/lib/falcon-keys')
  })
})
