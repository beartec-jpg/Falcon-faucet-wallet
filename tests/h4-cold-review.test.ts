import { describe, expect, it, vi, beforeEach } from 'vitest'
import { reviewUnsignedTx, MAX_FEE_DROPS } from '@/lib/vault-review'
import { buildPaymentTxJson, buildFusdcPaymentTxJson, buildTrustSetTxJson } from '@/lib/falcon-tx-sign'
import { parseUnsignedPayment } from '@/lib/vault-protocol'

const VAULT = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'
const DEST = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe'
const ATTACKER = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH'
const ISSUER = 'rrrrrrrrrrrrrrrrrrrrBZbvji'
const NET = 2300
const common = { account: VAULT, sequence: 7, lastLedgerSequence: 1000, networkId: NET, publicKeyHex: 'FB' + '00'.repeat(897), fee: '12' }

const pay = () => buildPaymentTxJson({ ...common, destination: DEST, amountDrops: '1000000' })
const pkg = (tx_json: Record<string, unknown>, display: Record<string, unknown> = {}) => ({
  type: 'falcon-unsigned-tx', v: 1, codecVersion: 'falcon-ledger-codec-v1', networkId: NET,
  display: { transactionType: 'Payment', account: VAULT, destination: DEST, amountDrops: '1000000', fee: '12', sequence: 7, lastLedgerSequence: 1000, ...display },
  tx_json,
})

describe('H-4 cold review: accepts portal-built packages', () => {
  it('native Payment', () => {
    const r = reviewUnsignedTx(pkg(pay()), VAULT)
    expect(r.transactionType).toBe('Payment')
    if (r.transactionType !== 'Payment') return
    expect(r.destination).toBe(DEST)
    expect(r.amount).toEqual({ kind: 'native', drops: '1000000' })
    expect(r.tx).toEqual({ TransactionType: 'Payment', Account: VAULT, Fee: '12', Sequence: 7, LastLedgerSequence: 1000, Flags: 0, NetworkID: NET, Destination: DEST, Amount: '1000000' })
    expect(r.tx).not.toHaveProperty('SigningPubKey')
  })
  it('F-USDC Payment and TrustSet', () => {
    const f = reviewUnsignedTx(pkg(buildFusdcPaymentTxJson({ ...common, destination: DEST, issuer: ISSUER, currency: 'QUC', amount: '5.5' })), VAULT)
    expect(f.transactionType === 'Payment' && f.amount).toEqual({ kind: 'iou', currency: 'QUC', issuer: ISSUER, value: '5.5' })
    const t = reviewUnsignedTx(pkg(buildTrustSetTxJson({ ...common, currency: 'QUC', issuer: ISSUER, limit: '10000000' })), VAULT)
    expect(t.transactionType === 'TrustSet' && t.limit).toEqual({ currency: 'QUC', issuer: ISSUER, value: '10000000' })
  })
  it('parseUnsignedPayment goes by tx_json type, not display', () => {
    const p = pkg({ ...pay(), TransactionType: 'SetRegularKey', RegularKey: ATTACKER }, { transactionType: 'Payment' })
    expect(() => parseUnsignedPayment(JSON.stringify(p))).toThrow(/Payment or TrustSet/)
  })
})

describe('H-4 cold review: mismatched or hostile packages', () => {
  it('ignores display: the review shows the real destination and amount', () => {
    const evil = { ...pay(), Destination: ATTACKER, Amount: '99999999000000' }
    const r = reviewUnsignedTx(pkg(evil, { destination: DEST, amountDrops: '1' }), VAULT)
    expect(r.transactionType === 'Payment' && r.destination).toBe(ATTACKER)
    expect(r.transactionType === 'Payment' && r.amount).toEqual({ kind: 'native', drops: '99999999000000' })
  })
  it.each([
    ['SetRegularKey', { TransactionType: 'SetRegularKey', RegularKey: ATTACKER }],
    ['SignerListSet', { TransactionType: 'SignerListSet' }],
    ['AccountDelete', { TransactionType: 'AccountDelete' }],
    ['AccountSet', { TransactionType: 'AccountSet' }],
    ['EscrowCreate', { TransactionType: 'EscrowCreate' }],
  ])('rejects %s', (_n, patch) => {
    expect(() => reviewUnsignedTx(pkg({ ...pay(), ...patch }), VAULT)).toThrow(/not allowed|unexpected field/)
  })
  it.each([
    ['RegularKey on Payment', { RegularKey: ATTACKER }],
    ['SendMax', { SendMax: '1' }],
    ['Paths', { Paths: [] }],
    ['DeliverMin', { DeliverMin: '1' }],
    ['Memos', { Memos: [] }],
    ['TxnSignature', { TxnSignature: 'AA' }],
    ['Signers', { Signers: [] }],
    ['DestinationTag', { DestinationTag: 1 }],
    ['__proto__-ish key', { constructor: 'x' }],
  ])('rejects extra field: %s', (_n, patch) => {
    expect(() => reviewUnsignedTx(pkg({ ...pay(), ...patch }), VAULT)).toThrow(/unexpected field/)
  })
  it('rejects a different Account, flags, self-send and bad destination', () => {
    expect(() => reviewUnsignedTx(pkg({ ...pay(), Account: ATTACKER }), VAULT)).toThrow(/not this vault/)
    expect(() => reviewUnsignedTx(pkg({ ...pay(), Flags: 0x00020000 }), VAULT)).toThrow(/flags/)
    expect(() => reviewUnsignedTx(pkg({ ...pay(), Destination: VAULT }), VAULT)).toThrow(/vault itself/)
    expect(() => reviewUnsignedTx(pkg({ ...pay(), Destination: 'alice' }), VAULT)).toThrow(/destination/)
  })
  it('caps the fee', () => {
    expect(() => reviewUnsignedTx(pkg({ ...pay(), Fee: String(MAX_FEE_DROPS + 1) }), VAULT)).toThrow(/cap/)
    expect(() => reviewUnsignedTx(pkg({ ...pay(), Fee: 12 }), VAULT)).toThrow(/fee/)
    expect(reviewUnsignedTx(pkg({ ...pay(), Fee: String(MAX_FEE_DROPS) }), VAULT).fee).toBe(String(MAX_FEE_DROPS))
  })
  it('rejects bad amounts and network mismatches', () => {
    for (const Amount of ['0', '-1', '1.5', '1e6', 1000, '1' + '0'.repeat(18)]) {
      expect(() => reviewUnsignedTx(pkg({ ...pay(), Amount }), VAULT)).toThrow(/amount/i)
    }
    expect(() => reviewUnsignedTx(pkg({ ...pay(), Amount: { currency: 'QUC', issuer: ISSUER, value: '1', extra: 1 } }), VAULT)).toThrow(/unexpected/)
    expect(() => reviewUnsignedTx(pkg({ ...pay(), Amount: { currency: 'XRP', issuer: ISSUER, value: '1' } }), VAULT)).toThrow(/currency/)
    expect(() => reviewUnsignedTx(pkg({ ...pay(), NetworkID: 1 }), VAULT)).toThrow(/NetworkID/)
    const { NetworkID: _n, ...noNet } = pay() as Record<string, unknown>
    expect(() => reviewUnsignedTx(pkg(noNet), VAULT)).toThrow(/NetworkID/)
  })
  it('rejects a TrustSet with risky flags or self-issuer', () => {
    const ts = buildTrustSetTxJson({ ...common, currency: 'QUC', issuer: ISSUER, limit: '1' })
    expect(() => reviewUnsignedTx(pkg({ ...ts, Flags: 0x00010000 }), VAULT)).toThrow(/flags/)
    expect(() => reviewUnsignedTx(pkg({ ...ts, QualityIn: 1 }), VAULT)).toThrow(/unexpected/)
    expect(() => reviewUnsignedTx(pkg({ ...ts, LimitAmount: { currency: 'QUC', issuer: VAULT, value: '1' } }), VAULT)).toThrow(/vault itself/)
  })
})

describe('vault unlock challenges are single-use', () => {
  beforeEach(() => vi.resetModules())
  it('a verified challenge cannot be replayed', async () => {
    vi.doMock('@/lib/falcon-wasm', () => ({ getFalcon512: async () => ({ verify: () => true }) }))
    const store = new Map<string, string>()
    ;(globalThis as any).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    const { verifyUnlockResponse } = await import('@/lib/vault-unlock-verify')
    const { createUnlockChallenge } = await import('@/lib/vault-protocol')
    const ch = createUnlockChallenge(VAULT)
    const resp = { type: 'vault-unlock-resp' as const, v: 1 as const, address: VAULT, challenge: ch.challenge, expiresAt: ch.expiresAt, sig: 'AAAA' }
    const pub = 'FB' + '11'.repeat(897)
    expect(await verifyUnlockResponse(ch, resp, pub)).toBe(true)
    expect(await verifyUnlockResponse(ch, resp, pub)).toBe(false)
    // Also refused after a reload of the module (persisted in sessionStorage).
    vi.resetModules()
    vi.doMock('@/lib/falcon-wasm', () => ({ getFalcon512: async () => ({ verify: () => true }) }))
    const again = await import('@/lib/vault-unlock-verify')
    expect(await again.verifyUnlockResponse(ch, resp, pub)).toBe(false)
    const fresh = createUnlockChallenge(VAULT)
    expect(await again.verifyUnlockResponse(fresh, { ...resp, challenge: fresh.challenge, expiresAt: fresh.expiresAt }, pub)).toBe(true)
  })
})
