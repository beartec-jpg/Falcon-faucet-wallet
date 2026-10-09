/**
 * Resumable BTC Bridge out (FBTC → BTC, BitVM2 dest-lock).
 *
 * The flow has three irreversible steps: the FBTC burn on Falcon PL, the
 * dest-lock Kickoff on Bitcoin, and the dest take after CSV. Any of them can
 * fail part way (Kickoff request, broadcast, CSV wait, take). A retry must
 * RESUME the same withdrawal, never sign a second burn.
 *
 * - The record is keyed by the node's BTC withdraw note id,
 *   sha256("wd:BTC:{account}:{amount}:{dest}") (same derivation as the node's
 *   `btc_withdraw_note_id`), so the same withdrawal always maps to the same
 *   record and to the same on-chain withdraw note.
 * - The record is written BEFORE the burn is submitted, with the signed burn
 *   (public once broadcast; no secret material), so a crash mid-submit still
 *   resumes by re-broadcasting the same tx (same sequence → cannot apply twice).
 * - Once a Kickoff has been signed it is stored and re-broadcast on retry; a new
 *   Kickoff is not requested for a withdrawal that already has one. Single
 *   exception: Bitcoin reports the stored Kickoff's input as spent AND its own
 *   status is known to be unconfirmed (it can never confirm) — then it is
 *   discarded and a new Kickoff is requested. Unknown status never qualifies.
 * - If browser state is lost, the on-chain BTC rail withdraw note proves the
 *   burn happened; resume from it requires explicit confirmation because the
 *   chain does not record whether the Kickoff was already paid.
 *
 * This module has no runtime imports so it can be unit-tested in Node.
 */

export type BtcPegOutPhase =
  /** Burn signed and saved; may or may not have reached the ledger. */
  | 'burn_signed'
  /** Burn sealed on Falcon PL; no Kickoff yet. */
  | 'burned'
  /** Kickoff signed and saved; not yet confirmed broadcast. */
  | 'kickoff_signed'
  /** Kickoff broadcast (or already known to Bitcoin); waiting for CSV / take. */
  | 'kickoff_broadcast'
  /** Take signed, checked and saved; done only once it has ≥1 confirmation. */
  | 'take_broadcast'
  | 'done'

const PHASES: readonly BtcPegOutPhase[] = [
  'burn_signed',
  'burned',
  'kickoff_signed',
  'kickoff_broadcast',
  'take_broadcast',
  'done',
]

export type BtcPegOutRecord = {
  v: 1
  /** Node withdraw note id for (account, amount, dest). Record key. */
  noteId: string
  account: string
  network: string
  amountSats: number
  dest: string
  /** Account sequence the burn was signed with (-1 when recovered from chain). */
  sequence: number
  burnTxId: string
  /** Exact signed RailWithdraw JSON (public). Empty when recovered from chain. */
  burnRawJson: string
  phase: BtcPegOutPhase
  signedKickoffHex?: string
  kickoffTxid?: string
  claimSats?: number
  takeTxid?: string
  /** Exact signed take (checked against the Kickoff and dest before saving). */
  signedTakeHex?: string
  recoveredFromChain?: boolean
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface BtcPegOutStore {
  load(account: string, noteId: string): BtcPegOutRecord | null
  /** Must throw if the record could not be persisted — it is the safety boundary. */
  save(rec: BtcPegOutRecord): void
  remove(account: string, noteId: string): void
  /** Note ids of this account's completed withdrawals (one read). */
  doneNoteIds(account: string): Set<string>
  /** Records not yet `done` for this account (newest first). */
  listOpen(account: string): BtcPegOutRecord[]
}

export type ChainBtcWithdraw = { noteId: string; amountSats: number; externalTo: string }

export type SignedBurn = { tx_id: string; rawJson: string }

export interface BtcPegOutDeps {
  store: BtcPegOutStore
  accountSnap(): Promise<{ sequence: number; balance: number; btcSats: number }>
  /** On-chain open BTC withdraw notes for this account; `null` = unavailable. */
  listChainWithdrawals(): Promise<ChainBtcWithdraw[] | null>
  signBurn(sequence: number): Promise<SignedBurn>
  /** Submit exact signed JSON. Throws on rejection. */
  submitBurn(rawJson: string): Promise<void>
  requestKickoff(): Promise<{ signed_btc_tx: string; amount?: number }>
  /** Broadcast to Bitcoin; returns txid. */
  broadcast(rawHex: string): Promise<string>
  /** Confirmations of `txid`; `null` (or a throw) = unknown, never read as 0. */
  pollConfirmations(txid: string): Promise<number | null>
  /**
   * Who spent `txid:vout`, as agreed by every Bitcoin explorer (see
   * agreeSpender). `null` = unknown (an explorer failed or they disagree).
   */
  lookupSpender(txid: string, vout: number): Promise<SpenderView | null>
  requestTake(kickoffTxid: string, sats: number): Promise<{ take_txid?: string; signed_btc_tx?: string }>
  sleep(ms: number): Promise<void>
  now(): number
  onStep?(msg: string): void
  /**
   * Asked only when the burn is on-chain but this browser has no record of it.
   * Return true ONLY when it is certain no Kickoff was ever broadcast for this
   * burn (a pending Kickoff plus a new one could both pay). Absent → refuse.
   */
  confirmChainResume?(w: ChainBtcWithdraw): Promise<boolean>
  /**
   * Asked before a NEW burn when Falcon PL lists other BTC withdraw notes from
   * this account that this browser has no completed record of (the node never
   * prunes them, so they may be finished or not). Absent → refuse.
   */
  confirmFreshBurn?(others: ChainBtcWithdraw[]): Promise<boolean>
  /**
   * Run `fn` holding an exclusive PER-ACCOUNT lock across browser tabs
   * (navigator.locks). Per account, not per withdrawal: it also serializes the
   * checks for different amount/address pairs and guards that account's
   * storage key. Must throw if another tab holds it. Absent → no lock.
   */
  withLock?<T>(key: string, fn: () => Promise<T>): Promise<T>
}

export type BtcPegOutParams = {
  account: string
  network: string
  amountSats: number
  dest: string
  fee: number
  claimCsv: number
  /**
   * Largest amount a NEW Kickoff can pay right now (dynamic, from the instance
   * UTXO set). Checked only before a fresh burn: an existing withdrawal's own
   * Kickoff may already have spent that output.
   */
  maxFreshSats?: number | null
  timing?: Partial<BtcPegOutTiming>
}

export type BtcPegOutTiming = {
  /** Wait for the burn to seal. */
  burnWaitMs: number
  burnPollMs: number
  /** Extra on-chain checks before treating a consumed sequence as a dead burn. */
  chainRecheck: number
  kickoffWaitMs: number
  kickoffPollMs: number
  /** Wait for the take's first confirmation. */
  takeWaitMs: number
  takePollMs: number
}

const DEFAULT_TIMING: BtcPegOutTiming = {
  burnWaitMs: 180_000,
  burnPollMs: 1_500,
  chainRecheck: 3,
  kickoffWaitMs: 45 * 60_000,
  kickoffPollMs: 12_000,
  takeWaitMs: 30 * 60_000,
  takePollMs: 15_000,
}

/**
 * A signed Kickoff is only replaced when one of its inputs was spent by a
 * DIFFERENT transaction that every explorer reports at least this deep. Then
 * the old Kickoff can never confirm, so a new one cannot pay twice.
 */
export const KICKOFF_REPLACE_MIN_CONFS = 6

/** Largest fee the take may deduct from the Kickoff amount (walletd uses ~1000). */
export const MAX_TAKE_FEE_SATS = 2_000
/** Bitcoin dust limit: the payout must stay above it. */
const DUST_SATS = 546

export type SpenderView = { spent: false } | { spent: true; txid: string; confirmations: number | null }

/** One explorer's answer for an outpoint (`ok: false` = that explorer failed). */
export type ExplorerSpendAnswer = {
  ok: boolean
  spent?: boolean
  txid?: string
  confirmed?: boolean
  blockHeight?: number
  tip?: number
}

/**
 * Combine explorers' outspend answers. Unknown (`null`) unless at least
 * `minExplorers` answered and all agree on spent / spender txid. Confirmations
 * are the smallest reported; a confirmed spender with an unknown tip gives
 * `null` confirmations (unknown), never 0.
 */
export function agreeSpender(answers: ExplorerSpendAnswer[], minExplorers = 2): SpenderView | null {
  if (answers.length < minExplorers) return null
  if (answers.some((a) => !a.ok || typeof a.spent !== 'boolean')) return null
  if (answers.some((a) => a.spent !== answers[0].spent)) return null
  if (!answers[0].spent) return { spent: false }
  const txid = String(answers[0].txid ?? '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(txid)) return null
  if (answers.some((a) => String(a.txid ?? '').toLowerCase() !== txid)) return null
  let confs: number | null = Number.POSITIVE_INFINITY
  for (const a of answers) {
    let c: number | null
    if (!a.confirmed) c = 0
    else {
      const h = Number(a.blockHeight)
      const tip = Number(a.tip)
      c = Number.isFinite(h) && h > 0 && Number.isFinite(tip) && tip >= h ? tip - h + 1 : null
    }
    if (c === null) {
      confs = null
      break
    }
    confs = Math.min(confs as number, c)
  }
  return { spent: true, txid, confirmations: confs }
}

export type BtcPegOutResult = {
  txId: string
  noteId: string
  kickoffTxid: string
  takeTxid: string
  resumed: boolean
}

// ── hashing ──────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/i, '')
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error('bad hex')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0')
  return s
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('WebCrypto unavailable')
  const copy = new Uint8Array(data.length)
  copy.set(data)
  return new Uint8Array(await subtle.digest('SHA-256', copy.buffer as ArrayBuffer))
}

/** Same derivation as the node's `btc_withdraw_note_id`. */
export async function btcWithdrawNoteId(account: string, amountSats: number, dest: string): Promise<string> {
  const msg = `wd:BTC:${account}:${Math.floor(amountSats)}:${dest}`
  return bytesToHex(await sha256(new TextEncoder().encode(msg)))
}

export type DecodedBtcTx = {
  txid: string
  inputs: Array<{ txid: string; vout: number; witness: string[] }>
  outputs: Array<{ sats: number; spk: string }>
}

/** Parse a raw Bitcoin tx (legacy or segwit). Throws on malformed input. */
export async function decodeBtcTx(rawHex: string): Promise<DecodedBtcTx> {
  const b = hexToBytes(rawHex.trim())
  let p = 0
  const need = (n: number) => {
    if (p + n > b.length) throw new Error('truncated Bitcoin tx')
  }
  const varint = (): number => {
    need(1)
    const f = b[p++]
    if (f < 0xfd) return f
    const n = f === 0xfd ? 2 : f === 0xfe ? 4 : 8
    need(n)
    let v = 0
    for (let i = n - 1; i >= 0; i--) v = v * 256 + b[p + i]
    p += n
    if (!Number.isSafeInteger(v)) throw new Error('bad Bitcoin varint')
    return v
  }
  const take = (n: number) => {
    need(n)
    const out = b.subarray(p, p + n)
    p += n
    return out
  }
  need(4)
  p = 4
  let segwit = false
  if (b.length > 6 && b[4] === 0x00 && b[5] === 0x01) {
    segwit = true
    p = 6
  }
  const ioStart = p
  const nIn = varint()
  if (nIn === 0) throw new Error('Bitcoin tx has no inputs')
  const inputs: DecodedBtcTx['inputs'] = []
  for (let i = 0; i < nIn; i++) {
    const prev = take(32)
    const vb = take(4)
    const vout = (vb[0] | (vb[1] << 8) | (vb[2] << 16)) + vb[3] * 0x1000000
    const sl = varint()
    take(sl + 4)
    inputs.push({ txid: bytesToHex(new Uint8Array(prev).reverse()), vout, witness: [] })
  }
  const nOut = varint()
  const outputs: DecodedBtcTx['outputs'] = []
  for (let i = 0; i < nOut; i++) {
    const vb = take(8)
    let sats = 0
    for (let j = 7; j >= 0; j--) sats = sats * 256 + vb[j]
    if (!Number.isSafeInteger(sats)) throw new Error('bad Bitcoin output value')
    const sl = varint()
    outputs.push({ sats, spk: bytesToHex(take(sl)) })
  }
  const ioEnd = p
  if (segwit) {
    for (let i = 0; i < nIn; i++) {
      const items = varint()
      for (let j = 0; j < items; j++) inputs[i].witness.push(bytesToHex(take(varint())))
    }
  }
  need(4)
  const lockStart = p
  p += 4
  if (p !== b.length) throw new Error('trailing bytes in Bitcoin tx')
  const stripped = new Uint8Array(4 + (ioEnd - ioStart) + 4)
  stripped.set(b.subarray(0, 4), 0)
  stripped.set(b.subarray(ioStart, ioEnd), 4)
  stripped.set(b.subarray(lockStart, lockStart + 4), 4 + (ioEnd - ioStart))
  const h = await sha256(await sha256(stripped))
  return { txid: bytesToHex(h.reverse()), inputs, outputs }
}

/**
 * Bitcoin txid (display order) of a raw tx, legacy or segwit. Lets resume know
 * the Kickoff txid even when the explorer answers "already in mempool".
 */
export async function btcTxidFromRaw(rawHex: string): Promise<string> {
  return (await decodeBtcTx(rawHex)).txid
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

function bech32Polymod(values: number[]): number {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i]
  }
  return chk >>> 0
}

/**
 * scriptPubKey (hex) of a P2PKH or P2WPKH (bech32 v0) payout address — the
 * two address kinds the dest-lock supports. Throws on anything else.
 */
export async function btcDestScriptPubKey(address: string): Promise<string> {
  const a = address.trim()
  const lower = a.toLowerCase()
  const sep = lower.lastIndexOf('1')
  if (/^(bc|tb|bcrt)1/.test(lower) && sep > 0) {
    if (a !== lower && a !== a.toUpperCase()) throw new Error('mixed-case bech32 address')
    const hrp = lower.slice(0, sep)
    const data: number[] = []
    for (const ch of lower.slice(sep + 1)) {
      const v = BECH32.indexOf(ch)
      if (v < 0) throw new Error('bad bech32 character')
      data.push(v)
    }
    if (data.length < 7) throw new Error('bech32 address too short')
    const expanded = [...hrp].map((c) => c.charCodeAt(0) >> 5)
    expanded.push(0, ...[...hrp].map((c) => c.charCodeAt(0) & 31))
    if (bech32Polymod([...expanded, ...data]) !== 1) throw new Error('bad bech32 checksum')
    const words = data.slice(0, -6)
    if (words[0] !== 0) throw new Error('only P2WPKH (segwit v0) payout addresses are supported')
    let acc = 0
    let bits = 0
    const prog: number[] = []
    for (const w of words.slice(1)) {
      acc = (acc << 5) | w
      bits += 5
      if (bits >= 8) {
        bits -= 8
        prog.push((acc >> bits) & 0xff)
      }
    }
    if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) throw new Error('bad bech32 padding')
    if (prog.length !== 20) throw new Error('only P2WPKH (20-byte) payout addresses are supported')
    return '0014' + bytesToHex(new Uint8Array(prog))
  }
  let n = BigInt(0)
  for (const ch of a) {
    const v = B58.indexOf(ch)
    if (v < 0) throw new Error('bad base58 character')
    n = n * BigInt(58) + BigInt(v)
  }
  const bytes: number[] = []
  while (n > BigInt(0)) {
    bytes.unshift(Number(n % BigInt(256)))
    n /= BigInt(256)
  }
  for (const ch of a) {
    if (ch !== '1') break
    bytes.unshift(0)
  }
  if (bytes.length !== 25) throw new Error('bad base58 address length')
  const raw = new Uint8Array(bytes)
  const chk = await sha256(await sha256(raw.subarray(0, 21)))
  for (let i = 0; i < 4; i++) if (chk[i] !== raw[21 + i]) throw new Error('bad base58 checksum')
  if (raw[0] !== 0x00 && raw[0] !== 0x6f) throw new Error('only P2PKH or P2WPKH payout addresses are supported')
  return '76a914' + bytesToHex(raw.subarray(1, 21)) + '88ac'
}

/** hash160 inside a P2PKH / P2WPKH scriptPubKey. */
function spkHash160(spk: string): string {
  if (/^76a914[0-9a-f]{40}88ac$/.test(spk)) return spk.slice(6, 46)
  if (/^0014[0-9a-f]{40}$/.test(spk)) return spk.slice(4, 44)
  throw new Error('unsupported payout script')
}

/**
 * Check a signed Kickoff pays exactly `amount` to a dest-lock (P2WSH) at
 * vout 0. The dest inside that lock is checked again at take time, when the
 * take reveals the lock script.
 */
export async function checkKickoffTx(
  hex: string,
  amount: number,
): Promise<{ txid: string; lockProgram: string; inputs: Array<{ txid: string; vout: number }> }> {
  const tx = await decodeBtcTx(hex)
  const o = tx.outputs[0]
  if (!o) throw new Error('Kickoff has no outputs')
  if (o.sats !== amount) throw new Error(`Kickoff pays ${o.sats} sats, not the ${amount} sats requested`)
  if (!/^0020[0-9a-f]{64}$/.test(o.spk)) throw new Error('Kickoff output 0 is not a dest-lock script')
  return {
    txid: tx.txid,
    lockProgram: o.spk.slice(4),
    inputs: tx.inputs.map((i) => ({ txid: i.txid, vout: i.vout })),
  }
}

/**
 * Check a signed take spends this Kickoff's dest-lock (vout 0) through a lock
 * script for `destSpk`, and pays that address the amount less a small fee.
 * Returns the take txid.
 */
export async function checkTakeTx(
  takeHex: string,
  kickoffHex: string,
  amount: number,
  destSpk: string,
): Promise<string> {
  const kick = await checkKickoffTx(kickoffHex, amount)
  const take = await decodeBtcTx(takeHex)
  if (take.inputs.length !== 1 || take.inputs[0].txid !== kick.txid || take.inputs[0].vout !== 0) {
    throw new Error('take does not spend this Kickoff')
  }
  const ws = take.inputs[0].witness[take.inputs[0].witness.length - 1] ?? ''
  if (!ws || bytesToHex(await sha256(hexToBytes(ws))) !== kick.lockProgram) {
    throw new Error('take does not reveal this Kickoff\'s dest-lock script')
  }
  // claim script tail: DUP HASH160 <dest h160> EQUALVERIFY CHECKSIG ENDIF
  if (!ws.endsWith(`76a914${spkHash160(destSpk)}88ac68`)) {
    throw new Error('the dest-lock is not for this payout address')
  }
  const paid = take.outputs.filter((o) => o.spk === destSpk).reduce((n, o) => n + o.sats, 0)
  const minPaid = Math.max(DUST_SATS, amount - MAX_TAKE_FEE_SATS)
  if (paid > amount || paid < minPaid) {
    throw new Error(`take pays ${paid} sats to the payout address (expected ${amount} less a small fee)`)
  }
  return take.txid
}

// ── storage ──────────────────────────────────────────────────────────────────

export const BTC_PEGOUT_STORE_KEY = 'falcon-pl-btc-pegout-v1'
/** Completed record → minimal tombstone (no signed payloads). */
function tombstone(r: BtcPegOutRecord): BtcPegOutRecord {
  return {
    v: 1,
    noteId: r.noteId,
    account: r.account,
    network: r.network,
    amountSats: r.amountSats,
    dest: r.dest,
    sequence: r.sequence,
    burnTxId: r.burnTxId,
    burnRawJson: '',
    phase: 'done',
    kickoffTxid: r.kickoffTxid,
    takeTxid: r.takeTxid,
    recoveredFromChain: r.recoveredFromChain,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void }

function acctKey(account: string): string {
  return account.trim().toLowerCase()
}

/** Store backed by any localStorage-like KV (browser localStorage by default). */
export function kvBtcPegOutStore(kv: KV | null): BtcPegOutStore {
  // One storage key PER ACCOUNT: the per-account run lock then also guards
  // every read-modify-write, so tabs bridging from different accounts cannot
  // overwrite each other's records. Account names are encoded, so names like
  // "constructor" or "__proto__" never touch object prototypes.
  const keyFor = (account: string) => `${BTC_PEGOUT_STORE_KEY}:${encodeURIComponent(acctKey(account))}`
  // Unreadable storage THROWS: returning [] would let the next save overwrite
  // (and so lose) records of burns that are still in flight.
  const read = (account: string): BtcPegOutRecord[] => {
    if (!kv) return []
    let raw: string | null
    try {
      raw = kv.getItem(keyFor(account))
    } catch (e) {
      throw new Error(`Browser storage could not be read (${errMsg(e)})`)
    }
    if (raw === null) return []
    let v: unknown
    try {
      v = JSON.parse(raw)
    } catch {
      v = undefined
    }
    if (!Array.isArray(v) || v.some((r) => !r || typeof r !== 'object' || typeof (r as BtcPegOutRecord).noteId !== 'string')) {
      throw new Error(
        'Saved BTC Bridge out records in this browser are unreadable. Nothing was changed; ask for a manual check ' +
          'before bridging out again',
      )
    }
    return v as BtcPegOutRecord[]
  }
  const write = (account: string, list: BtcPegOutRecord[]) => {
    if (!kv) throw new Error('Browser storage is unavailable')
    const k = keyFor(account)
    const raw = JSON.stringify(list)
    kv.setItem(k, raw)
    if (kv.getItem(k) !== raw) throw new Error('Browser storage did not keep the write')
  }
  return {
    load(account, noteId) {
      return read(account).find((r) => r.noteId === noteId) ?? null
    },
    save(rec) {
      const list = read(rec.account).filter((r) => r.noteId !== rec.noteId)
      list.unshift({ ...rec })
      // Keep every open record; finished ones shrink to tombstones so completion
      // knowledge for each on-chain note survives (bounded generously).
      const open = list.filter((r) => r.phase !== 'done')
      const done = list.filter((r) => r.phase === 'done').map(tombstone)
      // Never evicted: the node keeps every note forever, so must we.
      write(rec.account, [...open, ...done])
    },
    remove(account, noteId) {
      // Throws on failure: the caller must not claim the record was cleared.
      write(account, read(account).filter((r) => r.noteId !== noteId))
    },
    doneNoteIds(account) {
      return new Set(read(account).filter((r) => r.phase === 'done').map((r) => r.noteId))
    },
    listOpen(account) {
      return read(account)
        .filter((r) => r.phase !== 'done')
        .sort((a, b) => b.updatedAt - a.updatedAt)
    },
  }
}

export function browserBtcPegOutStore(): BtcPegOutStore {
  let kv: KV | null = null
  try {
    kv = typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    kv = null
  }
  return kvBtcPegOutStore(kv)
}

/** Sync lookup for the UI (balance is already debited while a burn is open). */
export function findOpenBtcPegOut(
  account: string,
  amountSats: number,
  dest: string,
  store: BtcPegOutStore = browserBtcPegOutStore(),
): BtcPegOutRecord | null {
  return (
    store
      .listOpen(account)
      .find((r) => r.amountSats === Math.floor(amountSats) && r.dest === dest.trim()) ?? null
  )
}

// ── engine ───────────────────────────────────────────────────────────────────

/**
 * A stored record must describe exactly this withdrawal before it drives any
 * step. Returns a reason when it does not.
 */
async function storedRecordProblem(
  r: BtcPegOutRecord,
  want: { noteId: string; account: string; network: string; amount: number; dest: string },
): Promise<string | null> {
  if (r.v !== 1) return `unknown record version ${String(r.v)}`
  if (r.noteId !== want.noteId) return 'note id mismatch'
  if (typeof r.account !== 'string' || acctKey(r.account) !== acctKey(want.account)) return 'account mismatch'
  if (r.network !== want.network) return `network mismatch (${String(r.network)})`
  if (r.amountSats !== want.amount) return `amount mismatch (${String(r.amountSats)})`
  if (r.dest !== want.dest) return 'payout address mismatch'
  if (!PHASES.includes(r.phase)) return `unknown phase ${String(r.phase)}`
  if (r.claimSats != null && r.claimSats !== want.amount) return `claim amount mismatch (${String(r.claimSats)})`
  if (r.phase === 'burn_signed' && !r.burnRawJson) return 'signed burn missing'
  const needsKickoff = r.phase === 'kickoff_signed' || r.phase === 'kickoff_broadcast' || r.phase === 'take_broadcast'
  if (needsKickoff) {
    if (!r.signedKickoffHex) return 'signed Kickoff missing'
    try {
      const k = await checkKickoffTx(r.signedKickoffHex, want.amount)
      if (r.kickoffTxid && r.kickoffTxid !== k.txid) return 'Kickoff txid does not match its signed tx'
    } catch (e) {
      return `stored Kickoff invalid (${errMsg(e)})`
    }
    if (r.phase !== 'kickoff_signed' && !r.kickoffTxid) return 'Kickoff txid missing'
  }
  if (r.phase === 'take_broadcast') {
    if (!r.signedTakeHex || !r.takeTxid) return 'signed take missing'
    try {
      const destSpk = await btcDestScriptPubKey(want.dest)
      const tid = await checkTakeTx(r.signedTakeHex, r.signedKickoffHex as string, want.amount, destSpk)
      if (tid !== r.takeTxid) return 'take txid does not match its signed tx'
    } catch (e) {
      return `stored take invalid (${errMsg(e)})`
    }
  }
  return null
}

/**
 * True only when an input of this Kickoff was spent by a DIFFERENT tx that
 * every explorer reports ≥ KICKOFF_REPLACE_MIN_CONFS deep. Anything unknown
 * (explorer failure, disagreement, tip unknown, shallow) → false.
 */
async function kickoffProvablyDead(kickoffHex: string, amount: number, d: BtcPegOutDeps): Promise<boolean> {
  let k: Awaited<ReturnType<typeof checkKickoffTx>>
  try {
    k = await checkKickoffTx(kickoffHex, amount)
  } catch {
    return false
  }
  for (const inp of k.inputs) {
    let s: SpenderView | null = null
    try {
      s = await d.lookupSpender(inp.txid, inp.vout)
    } catch {
      s = null
    }
    if (
      s &&
      s.spent &&
      s.txid !== k.txid &&
      typeof s.confirmations === 'number' &&
      s.confirmations >= KICKOFF_REPLACE_MIN_CONFS
    ) {
      return true
    }
  }
  return false
}

async function confsOrNull(d: BtcPegOutDeps, txid: string): Promise<number | null> {
  try {
    const c = await d.pollConfirmations(txid)
    return typeof c === 'number' && Number.isFinite(c) && c >= 0 ? c : null
  } catch {
    return null
  }
}

function persist(store: BtcPegOutStore, rec: BtcPegOutRecord): void {
  try {
    store.save(rec)
  } catch (e) {
    throw new Error(
      `Could not save BTC Bridge out progress in this browser (${errMsg(e)}). Stopped before the next ` +
        'irreversible step. Allow site storage (not private mode) and press Bridge out again.',
    )
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Only explicit "this exact tx is already in mempool / chain" answers. */
function isAlreadyKnown(msg: string): boolean {
  return /txn-already-in-mempool|txn-already-known|already in (the )?mempool|already in block ?chain|transaction already in block chain|already have transaction|transaction outputs already in utxo set/i.test(
    msg,
  )
}

function isInputsGone(msg: string): boolean {
  return /missingorspent|missing[- ]inputs|bad-txns-inputs-missing/i.test(msg)
}

/**
 * Run (or resume) one BTC Bridge out. Never signs a second burn for a
 * withdrawal that has a record or an on-chain withdraw note.
 */
export async function runBtcPegOut(p: BtcPegOutParams, d: BtcPegOutDeps): Promise<BtcPegOutResult> {
  // One run per account at a time across tabs: the phase check and the next
  // irreversible step are not atomic in localStorage alone.
  if (d.withLock) {
    return d.withLock(`falcon-btc-pegout:${p.account.trim().toLowerCase()}`, () => runBtcPegOutLocked(p, d))
  }
  return runBtcPegOutLocked(p, d)
}

async function runBtcPegOutLocked(p: BtcPegOutParams, d: BtcPegOutDeps): Promise<BtcPegOutResult> {
  const t: BtcPegOutTiming = { ...DEFAULT_TIMING, ...(p.timing ?? {}) }
  const amount = Math.floor(p.amountSats)
  const dest = p.dest.trim()
  const noteId = await btcWithdrawNoteId(p.account, amount, dest)
  const step = (m: string) => d.onStep?.(m)

  let rec: BtcPegOutRecord | null
  try {
    rec = d.store.load(p.account, noteId)
  } catch (e) {
    throw new Error(`${errMsg(e)}. No burn, Kickoff or take was signed.`)
  }
  if (rec) {
    const problem = await storedRecordProblem(rec, { noteId, account: p.account, network: p.network, amount, dest })
    if (problem) {
      throw new Error(
        `The saved progress for this Bridge out does not match it (${problem}). Nothing was signed or sent — ` +
          `ask for a manual check of withdrawal ${noteId.slice(0, 12)}….`,
      )
    }
  }
  // Phase changes must persist, or a retry could repeat an irreversible step.
  const save = (patch: Partial<BtcPegOutRecord>) => {
    rec = { ...(rec as BtcPegOutRecord), ...patch, updatedAt: d.now() }
    persist(d.store, rec)
    return rec
  }
  // Error notes are best-effort; never mask the original failure.
  const note = (lastError: string) => {
    rec = { ...(rec as BtcPegOutRecord), lastError, updatedAt: d.now() }
    try {
      d.store.save(rec)
    } catch {
      /* ignore */
    }
  }

  if (rec?.phase === 'done') {
    throw new Error(
      `This exact Bridge out (${amount} sats to ${dest}) already completed. ` +
        'Falcon PL refuses the same amount to the same address twice — change the amount by at least 1 sat.',
    )
  }

  // A different withdrawal is still open: finish it first, do not start a second burn.
  if (!rec) {
    const other = d.store.listOpen(p.account).find((r) => r.noteId !== noteId)
    if (other) {
      throw new Error(
        `A BTC Bridge out of ${other.amountSats} sats to ${other.dest} is still in progress (${other.phase}). ` +
          'Press Bridge out with that same amount to resume it — a new withdrawal would burn FBTC again.',
      )
    }
  }

  const resumed = !!rec
  const resumedAt: BtcPegOutPhase | null = rec ? rec.phase : null
  let chain: ChainBtcWithdraw[] | null = null
  const noteOnChain = async (): Promise<boolean | null> => {
    try {
      chain = await d.listChainWithdrawals()
    } catch {
      chain = null
    }
    if (!chain) return null
    return chain.some((w) => w.noteId === noteId)
  }

  // ── 0. No local record: is the burn already on-chain (lost browser state)? ──
  // The account sequence is read BEFORE the chain list; a fresh burn re-reads it
  // and refuses if anything committed in between (e.g. an in-flight burn whose
  // local record was lost), so a list taken before that commit is never trusted.
  let seqBeforeChain: number | null = null
  if (!rec) {
    seqBeforeChain = (await d.accountSnap()).sequence
    const onChain = await noteOnChain()
    if (onChain) {
      const w = (chain as ChainBtcWithdraw[] | null)?.find((x) => x.noteId === noteId) ?? {
        noteId,
        amountSats: amount,
        externalTo: dest,
      }
      const ok = d.confirmChainResume ? await d.confirmChainResume(w) : false
      if (!ok) {
        throw new Error(
          `Falcon PL already has a burn for ${amount} sats to ${dest} from this account (note ${noteId.slice(0, 12)}…). ` +
            'No new burn was made. Resume it only if you are certain no Kickoff was broadcast for it; if unsure, ask for ' +
            'a manual check of this withdrawal.',
        )
      }
      const now = d.now()
      rec = {
        v: 1,
        noteId,
        account: p.account,
        network: p.network,
        amountSats: amount,
        dest,
        sequence: -1,
        burnTxId: '',
        burnRawJson: '',
        phase: 'burned',
        recoveredFromChain: true,
        createdAt: now,
        updatedAt: now,
      }
      persist(d.store, rec)
      step('Found your FBTC burn on Falcon PL — resuming at Kickoff (no new burn)…')
    }
  }

  // ── 1. Fresh burn: save BEFORE submit so any failure is resumable. ──
  if (!rec) {
    // Never start a new burn blind: with no local record, an earlier unfinished
    // withdrawal (different amount/address) is only visible on-chain.
    if (chain === null) {
      throw new Error(
        'Could not check Falcon PL for an earlier unfinished BTC Bridge out. No burn was made — try again shortly.',
      )
    }
    // One read of this account's completed note ids (history is never pruned).
    const doneIds = d.store.doneNoteIds(p.account)
    const unknownOthers = (chain as ChainBtcWithdraw[]).filter(
      (w) => w.noteId !== noteId && !doneIds.has(w.noteId),
    )
    if (unknownOthers.length > 0) {
      const ok = d.confirmFreshBurn ? await d.confirmFreshBurn(unknownOthers) : false
      if (!ok) {
        const list = unknownOthers
          .slice(0, 3)
          .map((w) => `${w.amountSats} sats to ${w.externalTo}`)
          .join('; ')
        throw new Error(
          `Falcon PL shows earlier BTC Bridge outs from this account that this browser has no record of (${list}). ` +
            'If one is unfinished, resume it by entering that same amount. No new burn was made.',
        )
      }
    }
    if (p.maxFreshSats != null && amount > p.maxFreshSats) {
      throw new Error(
        `This Kickoff can pay at most ${p.maxFreshSats} sats. It spends one Bitcoin output, not the whole instance.`,
      )
    }
    const snap = await d.accountSnap()
    if (seqBeforeChain === null || snap.sequence !== seqBeforeChain) {
      throw new Error(
        'This account changed on Falcon PL while the earlier-withdrawal check ran. No burn was made — press ' +
          'Bridge out again so the check is repeated.',
      )
    }
    if (snap.btcSats < amount) {
      throw new Error(`Insufficient FBTC (have ${(snap.btcSats / 1e8).toFixed(8)})`)
    }
    if (snap.balance < p.fee) throw new Error(`Need ${p.fee} FPL for the withdraw fee`)
    step('Burning FBTC (no FROST Kickoff)…')
    const burn = await d.signBurn(snap.sequence)
    if (!burn.rawJson) throw new Error('withdraw sign missing exact JSON')
    const now = d.now()
    rec = {
      v: 1,
      noteId,
      account: p.account,
      network: p.network,
      amountSats: amount,
      dest,
      sequence: snap.sequence,
      burnTxId: burn.tx_id,
      burnRawJson: burn.rawJson,
      phase: 'burn_signed',
      createdAt: now,
      updatedAt: now,
    }
    // Safety boundary: no durable record → no burn.
    persist(d.store, rec)
    try {
      await d.submitBurn(burn.rawJson)
    } catch (e) {
      // Keep the record: a retry re-broadcasts this same signed burn.
      note(errMsg(e))
      throw new Error(
        `Burn submit failed (${errMsg(e)}). Press Bridge out again with the same amount — ` +
          'it re-sends this same signed burn and cannot burn twice.',
      )
    }
  } else if (rec.phase !== 'burn_signed') {
    step('Resuming pending BTC Bridge out (no new burn)…')
  }

  // ── 2. Make sure the burn is sealed. ──
  if (rec.phase === 'burn_signed') {
    if (resumed) step('Resuming pending BTC Bridge out — checking the burn (no new burn)…')
    const sealed = await waitBurnSealed(rec, d, t, noteOnChain)
    if (sealed === 'dead') {
      // Sequence consumed by something else and the note is not on-chain:
      // the signed burn can never apply. Drop the record; nothing was burned.
      try {
        d.store.remove(rec.account, rec.noteId)
      } catch (e) {
        throw new Error(
          `The earlier burn never sealed and can no longer apply, but this browser could not clear its record ` +
            `(${errMsg(e)}). No FBTC was burned for it. Allow site storage and press Bridge out again.`,
        )
      }
      throw new Error(
        'The earlier burn never sealed and can no longer apply (its sequence was used by another transaction). ' +
          'No FBTC was burned for it. Press Bridge out again to start fresh.',
      )
    }
    if (sealed === 'pending') {
      note('burn not sealed yet')
      throw new Error(
        'Burn is signed, but Falcon PL has not confirmed it sealed yet. Press Bridge out again later with the ' +
          'same amount — it re-uses the same signed burn and cannot burn twice.',
      )
    }
    save({ phase: 'burned', lastError: undefined })
  }

  // ── 3. Kickoff: request once, then always re-broadcast the same tx. ──
  // The coordinator only SIGNS the Kickoff; this client is the only party that
  // broadcasts it. A Kickoff whose response was lost never reached Bitcoin, so
  // asking again while still `burned` cannot pay twice. Once a signed Kickoff
  // is in hand it is checked, persisted before broadcast and reused from then
  // on. It is replaced only when provably dead (kickoffProvablyDead).
  if (rec.phase === 'burned') {
    step('Signing dest-lock Kickoff (claimer CHECKSIG)…')
    let kick: { signed_btc_tx: string; amount?: number }
    try {
      kick = await d.requestKickoff()
    } catch (e) {
      note(errMsg(e))
      throw new Error(
        `FBTC is burned but the Kickoff could not be signed (${errMsg(e)}). ` +
          'Press Bridge out again with the same amount to retry the Kickoff — it will not burn again.',
      )
    }
    if (!kick.signed_btc_tx) {
      note('Kickoff returned no tx')
      throw new Error('FBTC is burned but the Kickoff came back empty. Press Bridge out again to retry — no new burn.')
    }
    // Never broadcast a Kickoff that does not pay exactly this withdrawal.
    let kickoffTxid: string
    try {
      if (kick.amount != null && Number(kick.amount) !== amount) {
        throw new Error(`Kickoff amount ${String(kick.amount)} ≠ ${amount} sats requested`)
      }
      kickoffTxid = (await checkKickoffTx(kick.signed_btc_tx, amount)).txid
    } catch (e) {
      note(`Kickoff rejected: ${errMsg(e)}`)
      throw new Error(
        `FBTC is burned, but the signed Kickoff does not match this withdrawal (${errMsg(e)}). It was NOT ` +
          'broadcast. No new burn — ask for a manual check before retrying.',
      )
    }
    save({
      phase: 'kickoff_signed',
      signedKickoffHex: kick.signed_btc_tx,
      kickoffTxid,
      claimSats: amount,
      lastError: undefined,
    })
  }

  /**
   * Broadcast refused because an input is spent. Replace the Kickoff only if
   * provably dead; otherwise keep the SAME Kickoff and ask for a manual check.
   */
  const inputsGone = async (msg: string): Promise<never> => {
    const kickoffTxid = (rec as BtcPegOutRecord).kickoffTxid as string
    if (await kickoffProvablyDead((rec as BtcPegOutRecord).signedKickoffHex as string, amount, d)) {
      save({ phase: 'burned', signedKickoffHex: undefined, kickoffTxid: undefined, lastError: msg })
      throw new Error(
        `FBTC is burned, but the signed Kickoff's Bitcoin input was spent by another transaction that is now ` +
          `${KICKOFF_REPLACE_MIN_CONFS}+ blocks deep, so it can never confirm. Press Bridge out again with the same ` +
          'amount to get a new Kickoff — no new burn.',
      )
    }
    note(msg)
    throw new Error(
      `Bitcoin reports the Kickoff's input as spent (${msg}), and it could not be proven that this Kickoff ` +
        `(${kickoffTxid}) can never confirm. It is kept as is — no new Kickoff, no new burn. Ask for a manual ` +
        'check of this Kickoff before retrying.',
    )
  }

  if (rec.phase === 'kickoff_signed') {
    step('Broadcasting dest-lock Kickoff to Bitcoin testnet…')
    const txid = rec.kickoffTxid as string
    try {
      const got = (await d.broadcast(rec.signedKickoffHex as string)).trim().toLowerCase()
      if (/^[0-9a-f]{64}$/.test(got) && got !== txid) {
        // The locally computed txid of the signed tx is authoritative.
        note(`broadcast returned ${got}, expected ${txid}`)
        throw new Error(
          `Bitcoin answered with a different txid (${got}) than the signed Kickoff (${txid}). Kept the same ` +
            'Kickoff — press Bridge out again with the same amount. No new burn.',
        )
      }
    } catch (e) {
      if (e instanceof Error && /different txid/.test(e.message)) throw e
      const msg = errMsg(e)
      if (isInputsGone(msg)) {
        // Our own Kickoff may already be confirmed (it spent the input).
        const own = await confsOrNull(d, txid)
        if (own === null || own < 1) await inputsGone(msg)
      } else if (!isAlreadyKnown(msg)) {
        note(msg)
        throw new Error(
          `FBTC is burned and the Kickoff is signed, but the broadcast failed (${msg}). ` +
            'Press Bridge out again with the same amount — it re-broadcasts the same Kickoff, no new burn.',
        )
      } else {
        step('Kickoff already known to Bitcoin…')
      }
    }
    save({ phase: 'kickoff_broadcast', kickoffTxid: txid, lastError: undefined })
  }

  // ── 4. CSV wait then dest take. ──
  if (rec.phase === 'kickoff_broadcast' && resumedAt === 'kickoff_broadcast') {
    // Resumed while maybe unconfirmed: the Kickoff may have been dropped from
    // mempools. Re-broadcast the SAME signed tx (never a new one) before polling.
    const confs = await confsOrNull(d, rec.kickoffTxid as string)
    if (confs === null || confs === 0) {
      step('Re-broadcasting the same Kickoff…')
      try {
        await d.broadcast(rec.signedKickoffHex as string)
      } catch (e) {
        const msg = errMsg(e)
        if (isInputsGone(msg)) await inputsGone(msg)
        /* already known / transient: keep polling the same txid */
      }
    }
  }

  if (rec.phase === 'kickoff_broadcast') {
    const kickoffTxid = rec.kickoffTxid as string
    const need = p.claimCsv
    const t0 = d.now()
    let confs = 0
    while (d.now() - t0 < t.kickoffWaitMs) {
      const c = await confsOrNull(d, kickoffTxid)
      if (c !== null) confs = c
      step(`Kickoff confirmations ${confs} / ${need} (CSV=${need})…`)
      if (confs >= need) break
      await d.sleep(t.kickoffPollMs)
    }
    if (confs < need) {
      note(`Kickoff ${confs}/${need} confirmations`)
      throw new Error(
        `FBTC burned and dest-lock Kickoff posted. Wait for ${need} Bitcoin confirmations, then press Bridge out ` +
          `again with the same amount to take (txid ${kickoffTxid}). No new burn will be made.`,
      )
    }
    step('Dest take after CSV…')
    let take: { take_txid?: string; signed_btc_tx?: string }
    try {
      take = await d.requestTake(kickoffTxid, amount)
    } catch (e) {
      note(errMsg(e))
      throw new Error(
        `Kickoff is confirmed but the take failed (${errMsg(e)}). Press Bridge out again with the same amount ` +
          'to retry the take — no new burn.',
      )
    }
    // The signed take is required: it is checked (spends this Kickoff through
    // the dest-lock for this address, pays this address) before it is saved.
    let takeTxid: string
    try {
      if (!take.signed_btc_tx) throw new Error('no signed take returned')
      takeTxid = await checkTakeTx(take.signed_btc_tx, rec.signedKickoffHex as string, amount, await btcDestScriptPubKey(dest))
      const claimed = String(take.take_txid ?? '').trim().toLowerCase()
      if (claimed && claimed !== takeTxid) {
        throw new Error(`take txid ${claimed} does not match its signed transaction ${takeTxid}`)
      }
    } catch (e) {
      note(`take rejected: ${errMsg(e)}`)
      throw new Error(
        `Kickoff is confirmed but the take did not check out (${errMsg(e)}). Nothing was broadcast — press ` +
          'Bridge out again with the same amount to retry the take. No new burn.',
      )
    }
    save({ phase: 'take_broadcast', signedTakeHex: take.signed_btc_tx as string, takeTxid, lastError: undefined })
  }

  // ── 5. Take: done only after ≥1 confirmation of THIS take txid. ──
  if (rec.phase === 'take_broadcast') {
    const takeTxid = rec.takeTxid as string
    const kickoffTxid = rec.kickoffTxid as string
    let confs = await confsOrNull(d, takeTxid)
    if (confs === null || confs < 1) {
      step('Broadcasting the take to Bitcoin…')
      try {
        const got = (await d.broadcast(rec.signedTakeHex as string)).trim().toLowerCase()
        if (/^[0-9a-f]{64}$/.test(got) && got !== takeTxid) {
          note(`take broadcast returned ${got}, expected ${takeTxid}`)
          throw new Error(
            `Bitcoin answered with a different txid (${got}) than the signed take (${takeTxid}). Not marked done — ` +
              'press Bridge out again with the same amount. No new burn.',
          )
        }
      } catch (e) {
        if (e instanceof Error && /different txid/.test(e.message)) throw e
        const msg = errMsg(e)
        if (isInputsGone(msg)) {
          confs = await confsOrNull(d, takeTxid)
          if (confs === null || confs < 1) {
            note(msg)
            throw new Error(
              `Bitcoin reports the Kickoff output as already spent (${msg}), but this take (${takeTxid}) is not ` +
                `confirmed. Not marked done — ask for a manual check of Kickoff ${kickoffTxid}. No new burn.`,
            )
          }
        } else if (!isAlreadyKnown(msg)) {
          note(msg)
          throw new Error(
            `The take broadcast failed (${msg}). Press Bridge out again with the same amount — it re-sends the ` +
              'same take. No new burn.',
          )
        }
      }
    }
    const t0 = d.now()
    while ((confs === null || confs < 1) && d.now() - t0 < t.takeWaitMs) {
      step('Waiting for the take to confirm on Bitcoin…')
      await d.sleep(t.takePollMs)
      confs = await confsOrNull(d, takeTxid)
    }
    if (confs === null || confs < 1) {
      note('take not confirmed yet')
      throw new Error(
        `The take (${takeTxid}) is broadcast but not confirmed yet. Press Bridge out again later with the same ` +
          'amount to check it — it re-sends the same take. No new burn.',
      )
    }
    // Payout confirmed; a failed write here must not report an error. Worst case
    // a retry re-checks the same take, which is already confirmed.
    rec = { ...rec, phase: 'done', lastError: undefined, updatedAt: d.now() }
    try {
      d.store.save(rec)
    } catch {
      /* ignore */
    }
  }

  return {
    txId: rec.burnTxId,
    noteId,
    kickoffTxid: rec.kickoffTxid ?? '',
    takeTxid: rec.takeTxid ?? '',
    resumed,
  }
}

async function waitBurnSealed(
  rec: BtcPegOutRecord,
  d: BtcPegOutDeps,
  t: BtcPegOutTiming,
  noteOnChain: () => Promise<boolean | null>,
): Promise<'sealed' | 'dead' | 'pending'> {
  const t0 = d.now()
  let resent = false
  while (d.now() - t0 < t.burnWaitMs) {
    let seq: number | null = null
    try {
      seq = (await d.accountSnap()).sequence
    } catch {
      seq = null
    }
    if (seq !== null && seq > rec.sequence) {
      // Sequence moved. Only the on-chain note can say whether it was OUR burn.
      let unknown = false
      for (let i = 0; i <= t.chainRecheck; i++) {
        const on = await noteOnChain()
        if (on === true) return 'sealed'
        if (on === null) {
          // List unavailable: neither sealed nor dead. Keep waiting; never guess.
          unknown = true
          break
        }
        if (i < t.chainRecheck) await d.sleep(t.burnPollMs)
      }
      if (!unknown) return 'dead'
      d.onStep?.('Waiting for Falcon PL to confirm the burn…')
      await d.sleep(t.burnPollMs)
      continue
    }
    if (seq !== null && !resent && rec.burnRawJson) {
      // Not sealed yet: re-broadcast the SAME signed burn (same tx_id + sequence).
      resent = true
      try {
        await d.submitBurn(rec.burnRawJson)
      } catch {
        /* duplicate / already in mempool is fine */
      }
    }
    d.onStep?.('Waiting for Falcon PL to seal the burn…')
    await d.sleep(t.burnPollMs)
  }
  return 'pending'
}
