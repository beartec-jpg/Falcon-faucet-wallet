/**
 * Falcon PL 2300 BTC rail — Bitcoin SPV only.
 *
 * Wait for the header-submitter to ingest the deposit block (+ min confs),
 * then mint with a real hash256 merkle proof and the raw Bitcoin tx.
 */

import { signPlPay, signRailDeposit, signRailWithdraw } from './pl-wallet-sign'

const RAIL = 'BTC'
const FEE = 2
const NETWORK_ID = 2300
/** Dest-lock mint + Kickoff + CSV take e2e passed. Kickoff coordinator uses Bitcoin UTXOs. */
export const BTC_RAIL_LIVE = true

export type PlBtcRail = {
  asset: string
  tip_height: number
  tip_hash: string
  lock_id: string
  min_confirmations: number
  total_minted: number
  total_burned: number
  /** "bitcoin" once 2.9.35 has reanchored onto real BTC headers. */
  spv: 'bitcoin' | 'protocol'
}

async function postTx(tx: unknown, network: string): Promise<void> {
  const res = await fetch('/api/wallet/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx, network }),
  })
  const out = (await res.json()) as { success?: boolean; error?: string; message?: string }
  if (!res.ok || out.success === false) {
    throw new Error(out.error || out.message || 'Submit failed')
  }
}

async function accountSnap(account: string, network: string): Promise<{
  sequence: number
  balance: number
  btcSats: number
}> {
  const res = await fetch(
    `/api/wallet/account?address=${encodeURIComponent(account)}&network=${encodeURIComponent(network)}`,
  )
  const j = (await res.json()) as {
    sequence?: number
    balance?: number
    assets?: { BTC?: number; btc?: number; fbtc?: { balance?: number } }
    error?: string
  }
  if (!res.ok) throw new Error(j.error || 'account lookup failed')
  const raw = j.assets?.BTC ?? j.assets?.btc
  const fbtc = j.assets?.fbtc?.balance
  const btcSats =
    typeof raw === 'number'
      ? raw
      : typeof fbtc === 'number' && fbtc < 1_000
        ? Math.round(fbtc * 1e8)
        : typeof fbtc === 'number'
          ? fbtc
          : 0
  return { sequence: Number(j.sequence ?? 0), balance: Number(j.balance ?? 0), btcSats }
}

async function waitSeq(account: string, network: string, want: number, timeoutMs = 60_000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const s = await accountSnap(account, network)
    if (s.sequence >= want) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('Ledger did not commit the rail tx — wait and retry')
}

export async function fetchPlBtcRail(): Promise<PlBtcRail> {
  const res = await fetch('/api/bridge/btc-spv?network=testnet', { cache: 'no-store' })
  const j = (await res.json()) as {
    error?: string
    rail?: PlBtcRail
    spv?: string
    bridge?: { tipHeight?: number; tipHash?: string; minConfirmations?: number; lockId?: string }
  }
  if (!res.ok) throw new Error(j.error || 'rail status failed')
  const rail = j.rail
    ? { ...j.rail, spv: (j.rail.spv === 'bitcoin' || j.spv === 'bitcoin' ? 'bitcoin' : 'protocol') as PlBtcRail['spv'] }
    : {
        asset: RAIL,
        tip_height: Number(j.bridge?.tipHeight ?? 0),
        tip_hash: String(j.bridge?.tipHash ?? ''),
        lock_id: String(j.bridge?.lockId ?? ''),
        min_confirmations: Number(j.bridge?.minConfirmations ?? 6) || 6,
        total_minted: 0,
        total_burned: 0,
        spv: (j.spv === 'bitcoin' ? 'bitcoin' : 'protocol') as PlBtcRail['spv'],
      }
  return rail
}

function merklePathFromProofHex(proofHex: string): string[] {
  const h = proofHex.replace(/^0x/i, '').toLowerCase()
  if (h.length % 64 !== 0) throw new Error('Merkle proof length must be a multiple of 32 bytes')
  const out: string[] = []
  for (let i = 0; i < h.length; i += 64) out.push(h.slice(i, i + 64))
  return out
}

async function pegInBitcoinSpv(opts: {
  account: string
  falconSecret: string
  network: string
  amount: number
  txid: string
  rail0: PlBtcRail
  snap: { sequence: number; balance: number; btcSats: number }
  onStep?: (msg: string) => void
}): Promise<{ depositTxId: string; headerHeight: number }> {
  opts.onStep?.('Fetching Bitcoin merkle proof…')
  const { fetchSpvClaimMaterials } = await import('@/lib/btc-spv-client')
  const { verifyBitcoinMerkleProof } = await import('@/lib/btc-merkle')
  let materials: Awaited<ReturnType<typeof fetchSpvClaimMaterials>> | null = null
  const needConfs = Math.max(1, opts.rail0.min_confirmations)
  const proofT0 = Date.now()
  while (!materials) {
    try {
      const got = await fetchSpvClaimMaterials(opts.txid, 'testnet', 0, 'deposit')
      if (got.confirmations < needConfs) {
        opts.onStep?.(
          `Bitcoin confirmations ${got.confirmations} / ${needConfs}…`,
        )
      } else {
        materials = got
        break
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!/not confirmed|wait|indexing|header|mempool|unavailable|404|409/i.test(msg)) {
        throw e
      }
      opts.onStep?.(msg)
    }
    if (Date.now() - proofT0 > 30 * 60_000) {
      throw new Error('Timed out waiting for the Bitcoin merkle proof')
    }
    await new Promise((r) => setTimeout(r, 8_000))
  }
  const maybeRoot = (materials as { merkleRoot?: string }).merkleRoot
  if (maybeRoot) {
    const v = verifyBitcoinMerkleProof({
      txidDisplay: opts.txid,
      merkleProofHex: materials.merkleProofHex,
      txIndex: materials.txIndex,
      merkleRootDisplay: maybeRoot,
    })
    if (!v.ok) throw new Error(v.error || 'Client Bitcoin merkle verify failed')
  }

  const needTip = materials.blockHeight + Math.max(1, opts.rail0.min_confirmations) - 1
  const t0 = Date.now()
  while (true) {
    const rail = await fetchPlBtcRail()
    if (rail.spv !== 'bitcoin') {
      throw new Error('BTC rail is not in Bitcoin SPV mode yet — header submitter not rolled')
    }
    if (rail.tip_height >= needTip) break
    opts.onStep?.(
      `Waiting for Bitcoin headers ${rail.tip_height} / ${needTip} (header submitter)…`,
    )
    if (Date.now() - t0 > 20 * 60_000) {
      throw new Error(
        `Header submitter has not reached Bitcoin height ${needTip} (tip ${rail.tip_height})`,
      )
    }
    await new Promise((r) => setTimeout(r, 8_000))
  }

  opts.onStep?.('Minting FBTC from Bitcoin SPV proof…')
  const snap = await accountSnap(opts.account, opts.network)
  const dep = await signRailDeposit({
    account: opts.account,
    sequence: snap.sequence,
    asset: RAIL,
    to: opts.account,
    amount: opts.amount,
    proof: {
      external_txid: opts.txid,
      block_hash: materials.blockHash.replace(/^0x/i, '').toLowerCase(),
      height: materials.blockHeight,
      merkle_path: merklePathFromProofHex(materials.merkleProofHex),
      merkle_index: materials.txIndex,
      lock_id: opts.rail0.lock_id,
      parent_hash: '',
      merkle_root: (materials as { merkleRoot?: string }).merkleRoot
        ? String((materials as { merkleRoot?: string }).merkleRoot).replace(/^0x/i, '').toLowerCase()
        : '',
      external_to: '',
      raw_tx: materials.rawTxHex.replace(/^0x/i, '').toLowerCase(),
    },
    falconSecret: opts.falconSecret,
  })
  await postTx(dep, opts.network)
  await waitSeq(opts.account, opts.network, snap.sequence + 1)
  return { depositTxId: dep.tx_id, headerHeight: materials.blockHeight }
}

export async function pegInPlBtc(opts: {
  account: string
  falconSecret: string
  network: string
  externalTxid: string
  amountSats: number
  onStep?: (msg: string) => void
}): Promise<{ depositTxId: string; headerHeight: number }> {
  if (!BTC_RAIL_LIVE) {
    throw new Error('BTC rail is not live — e2e not passed (BTC_RAIL_LIVE=false)')
  }
  const amount = Math.floor(opts.amountSats)
  if (amount < 546) throw new Error('Amount too small')
  if (!/^[0-9a-f]{64}$/i.test(opts.externalTxid.replace(/^0x/i, ''))) {
    throw new Error('Need a full 64-character Bitcoin tx id')
  }
  const txid = opts.externalTxid.replace(/^0x/i, '').toLowerCase()

  let snap = await accountSnap(opts.account, opts.network)
  if (snap.balance < FEE) {
    throw new Error(`Need ${FEE} FPL on ${opts.account} for the mint fee (have ${snap.balance})`)
  }

  if (snap.sequence === 0) {
    opts.onStep?.('Enrolling this account on Falcon PL…')
    const pay = await signPlPay({
      account: opts.account,
      destination: 'faucet',
      amount: 0,
      sequence: 0,
      fee: FEE,
      networkId: NETWORK_ID,
      falconSecret: opts.falconSecret,
    })
    await postTx(pay, opts.network)
    await waitSeq(opts.account, opts.network, 1)
    snap = await accountSnap(opts.account, opts.network)
  }

  const rail0 = await fetchPlBtcRail()
  if (!rail0.lock_id) throw new Error('BTC rail lock id missing from node')
  if (rail0.spv !== 'bitcoin') {
    throw new Error('BTC rail is not in Bitcoin SPV mode — header submitter has not reanchored yet')
  }
  return pegInBitcoinSpv({ ...opts, amount, txid, rail0, snap })
}

export async function pegOutPlBtc(opts: {
  account: string
  falconSecret: string
  network: string
  amountSats: number
  btcAddress: string
}): Promise<{ txId: string }> {
  if (!BTC_RAIL_LIVE) {
    throw new Error('BTC rail is not live — e2e not passed (BTC_RAIL_LIVE=false)')
  }
  const amount = Math.floor(opts.amountSats)
  if (amount < 546) throw new Error('Amount too small')
  const dest = opts.btcAddress.trim()
  if (dest.length < 26) throw new Error('Need a Bitcoin payout address')
  const snap = await accountSnap(opts.account, opts.network)
  if (snap.btcSats < amount) {
    throw new Error(`Insufficient FBTC (have ${(snap.btcSats / 1e8).toFixed(8)})`)
  }
  if (snap.balance < FEE) throw new Error(`Need ${FEE} FPL for the withdraw fee`)
  const kick = await fetch('/api/wallet/pl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'btc-kickoff',
      account: opts.account,
      amount,
      dest,
    }),
  })
  const kickJ = (await kick.json()) as { error?: string; signed_btc_tx?: string }
  if (!kick.ok || !kickJ.signed_btc_tx) {
    throw new Error(kickJ.error || 'Kickoff coordinator failed')
  }
  const tx = await signRailWithdraw({
    account: opts.account,
    sequence: snap.sequence,
    asset: RAIL,
    amount,
    externalTo: dest,
    falconSecret: opts.falconSecret,
    signedBtcTx: kickJ.signed_btc_tx,
  })
  await postTx(tx, opts.network)
  await waitSeq(opts.account, opts.network, snap.sequence + 1)
  return { txId: tx.tx_id }
}
