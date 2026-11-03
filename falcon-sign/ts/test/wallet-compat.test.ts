// Cross-compat with the Falcon wallet's own signing code (../../src/lib).
// The wallet's browser WASM loader is swapped for the same liboqs build in Node.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { getFalcon, generateKeyPair, encodeFalconSecret, build, signTx, verifyTx, txId, txPayload, keyHash, verify, type UnsignedTx } from '../src/index.js'

vi.mock('../../../src/lib/falcon-wasm', () => ({ getFalcon512: () => getFalcon() }))

const W = await import('../../../src/lib/pl-wallet-sign')
const WK = await import('../../../src/lib/falcon-keys')

const VEC = new URL('../../vectors/', import.meta.url)
let secret = ''
let account = ''
const base = () => ({ account, sequence: 3, fee: 2, networkId: 2300 })

beforeAll(async () => {
  const kp = await generateKeyPair()
  secret = encodeFalconSecret(kp)
  account = kp.address
})

type Case = [string, () => Promise<{ tx_id: string; rawJson?: string } & Record<string, unknown>>, () => UnsignedTx]
const cases = (): Case[] => {
  const s = { falconSecret: secret, sequence: 3, fee: 2, networkId: 2300, account }
  const kh = 'ab'.repeat(32)
  return [
    ['pay', () => W.signPlPay({ ...s, destination: 'bob', amount: 1234 }), () => build.transfer({ ...base(), destination: 'bob', amount: 1234 })],
    ['asset_pay', () => W.signPlAssetPay({ ...s, destination: 'bob', asset: 'ETH', amount: '20000000000000001' }), () => build.assetTransfer({ ...base(), destination: 'bob', asset: 'ETH', amount: '20000000000000001' })],
    ['pay_to_key', () => W.signPlPayToKey({ ...s, destination: 'bob', amount: 9, keyHash: kh }), () => build.transferToKey({ ...base(), destination: 'bob', amount: 9, keyHash: kh })],
    ['swap_route', () => W.signPlSwapRoute({ ...s, tokenIn: 'FPL', tokenOut: 'USDC', amountIn: '1000', minOut: '1' }), () => build.swapRoute({ ...base(), tokenIn: 'FPL', tokenOut: 'USDC', amountIn: 1000, minOut: 1 })],
    ['add_liquidity', () => W.signPlAddLiquidity({ ...s, poolId: 'FPL-USDC', amtA: '10', amtB: '20' }), () => build.addLiquidity({ ...base(), poolId: 'FPL-USDC', amtA: 10, amtB: 20 })],
    ['remove_liquidity', () => W.signPlRemoveLiquidity({ ...s, poolId: 'FPL-USDC', lpBurn: '5' }), () => build.removeLiquidity({ ...base(), poolId: 'FPL-USDC', lpBurn: 5 })],
    ['lend_supply', () => W.signPlLend({ ...s, kind: 'lend_supply', marketId: 'USDC', amount: '7' }), () => build.lendSupply({ ...base(), marketId: 'USDC', amount: 7 })],
    ['lend_withdraw', () => W.signPlLend({ ...s, kind: 'lend_withdraw', marketId: 'USDC', amount: '7' }), () => build.lendWithdraw({ ...base(), marketId: 'USDC', shares: 7 })],
    ['lend_borrow', () => W.signPlLend({ ...s, kind: 'lend_borrow', marketId: 'USDC', amount: '7', collateralFpl: '100' }), () => build.lendBorrow({ ...base(), marketId: 'USDC', amount: 7, collateralFpl: 100 })],
    ['lend_repay', () => W.signPlLend({ ...s, kind: 'lend_repay', marketId: 'USDC', amount: '7' }), () => build.lendRepay({ ...base(), marketId: 'USDC', amount: 7 })],
    ['vault_open', () => W.signVaultOpen({ ...s, destination: 'cold' }), () => build.vaultOpen({ ...base(), destination: 'cold' })],
    ['vault_lock', () => W.signVaultLock(s), () => build.vaultLock(base())],
    ['claim', () => W.signPlClaim(s), () => build.claim(base())],
    ['watcher_heartbeat', () => W.signPlWatcherHeartbeat(s), () => build.watcherHeartbeat(base())],
    ['rail_withdraw', () => W.signRailWithdraw({ ...s, asset: 'BTC', amount: '15000', externalTo: 'tb1qexample' }), () => build.railWithdraw({ ...base(), asset: 'BTC', amount: 15000, externalTo: 'tb1qexample' })],
  ]
}

const wireOf = (w: Record<string, unknown>) => (w.rawJson as string | undefined) ?? JSON.stringify(Object.fromEntries(Object.entries(w).filter(([k]) => k !== 'rawJson')))

describe('wallet <-> SDK', () => {
  it('same address and falcon_secret layout as the wallet', async () => {
    const d = WK.decodeFalconSecret(secret)
    expect(WK.addressFromPubBlob(d.pubBlob)).toBe(account)
    expect(WK.validateFalconSecret(secret)).toBe(true)
  })

  it('wallet-signed txs verify in the SDK, tx ids match, SDK-signed verify with liboqs', async () => {
    const walletVec: unknown[] = []
    const sdkVec: unknown[] = []
    for (const [name, wsign, sdkBuild] of cases()) {
      const w = await wsign()
      const u = sdkBuild()
      expect(w.tx_id, name).toBe(txId(u))
      const wire = wireOf(w)
      expect(await verifyTx(wire), name).toEqual({ ok: true, txId: w.tx_id })
      const s = await signTx(u, secret)
      expect(s.txId, name).toBe(w.tx_id)
      expect(await verify(txPayload(u), s.tx.signature, s.tx.public_key), name).toBe(true)
      walletVec.push({ name, source: 'wallet', json: wire })
      sdkVec.push({ name, source: 'sdk-ts', json: s.json })
    }
    // Wallet set-external-address uses kind "SetExternalAddr"; the node's serde tag is
    // "set_external_addrs" (alias "set_external_addr"). Recorded as an expected reject.
    const wx = await W.signPlSetExternalAddr({ falconSecret: secret, sequence: 3, fee: 2, networkId: 2300, account, chain: 'btc', address: 'tb1qexample' })
    const ux = build.setExternalAddr({ ...base(), chain: 'btc', address: 'tb1qexample' })
    expect(wx.tx_id).not.toBe(txId(ux))
    walletVec.push({ name: 'set_external_addr(wallet kind SetExternalAddr)', source: 'wallet', json: wireOf(wx), expect: 'reject' })
    sdkVec.push({ name: 'set_external_addrs', source: 'sdk-ts', json: (await signTx(ux, secret)).json })
    for (const extra of [
      build.placeLimitOrder({ ...base(), pair: 'FPL/USDC', side: 'sell', price: 123, amount: 456 }),
      build.placeLimitOrder({ ...base(), pair: 'FPL/USDC', side: 'buy', price: 1, amount: 2, expiryHeight: 999 }),
      build.cancelOrder({ ...base(), orderId: '18446744073709551615' }),
      build.assetTransfer({ ...base(), destination: 'bob', asset: 'ETH', amount: '18446744073709551615' }),
      build.transferToKey({ ...base(), destination: 'bob', amount: 1, keyHash: keyHash(WK.decodeFalconSecret(secret).pubBlob.slice(1)) }),
    ]) sdkVec.push({ name: extra.body.kind, source: 'sdk-ts', json: (await signTx(extra, secret)).json })
    mkdirSync(VEC, { recursive: true })
    writeFileSync(new URL('wallet-signed.json', VEC), JSON.stringify(walletVec, null, 1) + '\n')
    writeFileSync(new URL('sdk-ts-signed.json', VEC), JSON.stringify(sdkVec, null, 1) + '\n')
  })
})
