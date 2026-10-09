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
 *   Kickoff is never requested for a withdrawal that already has one.
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
  | 'done'

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
  pollConfirmations(txid: string): Promise<number>
  requestTake(kickoffTxid: string, sats: number): Promise<{ take_txid?: string; signed_btc_tx?: string }>
  sleep(ms: number): Promise<void>
  now(): number
  onStep?(msg: string): void
  /**
   * Asked only when the burn is on-chain but this browser has no record of it.
   * Return true to resume at Kickoff. Absent → refuse (never guess).
   */
  confirmChainResume?(w: ChainBtcWithdraw): Promise<boolean>
  /**
   * Asked before a NEW burn when Falcon PL lists other BTC withdraw notes from
   * this account that this browser has no completed record of (the node never
   * prunes them, so they may be finished or not). Absent → refuse.
   */
  confirmFreshBurn?(others: ChainBtcWithdraw[]): Promise<boolean>
  /**
   * Run `fn` holding an exclusive per-withdrawal lock across browser tabs
   * (navigator.locks). Must throw if another tab holds it. Absent → no lock.
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
}

const DEFAULT_TIMING: BtcPegOutTiming = {
  burnWaitMs: 180_000,
  burnPollMs: 1_500,
  chainRecheck: 3,
  kickoffWaitMs: 45 * 60_000,
  kickoffPollMs: 12_000,
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

/**
 * Bitcoin txid (display order) of a raw tx, legacy or segwit. Lets resume know
 * the Kickoff txid even when the explorer answers "already in mempool".
 */
export async function btcTxidFromRaw(rawHex: string): Promise<string> {
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
    return v
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
  for (let i = 0; i < nIn; i++) {
    need(36)
    p += 36
    const sl = varint()
    need(sl + 4)
    p += sl + 4
  }
  const nOut = varint()
  for (let i = 0; i < nOut; i++) {
    need(8)
    p += 8
    const sl = varint()
    need(sl)
    p += sl
  }
  const ioEnd = p
  if (segwit) {
    for (let i = 0; i < nIn; i++) {
      const items = varint()
      for (let j = 0; j < items; j++) {
        const l = varint()
        need(l)
        p += l
      }
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
  return bytesToHex(h.reverse())
}

// ── storage ──────────────────────────────────────────────────────────────────

export const BTC_PEGOUT_STORE_KEY = 'falcon-pl-btc-pegout-v1'
const MAX_RECORDS_PER_ACCOUNT = 20

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void }

function acctKey(account: string): string {
  return account.trim().toLowerCase()
}

/** Store backed by any localStorage-like KV (browser localStorage by default). */
export function kvBtcPegOutStore(kv: KV | null): BtcPegOutStore {
  const read = (): Record<string, BtcPegOutRecord[]> => {
    if (!kv) return {}
    try {
      const raw = kv.getItem(BTC_PEGOUT_STORE_KEY)
      const m = raw ? (JSON.parse(raw) as Record<string, BtcPegOutRecord[]>) : {}
      return m && typeof m === 'object' ? m : {}
    } catch {
      return {}
    }
  }
  const write = (m: Record<string, BtcPegOutRecord[]>) => {
    if (!kv) throw new Error('Browser storage is unavailable')
    const raw = JSON.stringify(m)
    kv.setItem(BTC_PEGOUT_STORE_KEY, raw)
    if (kv.getItem(BTC_PEGOUT_STORE_KEY) !== raw) throw new Error('Browser storage did not keep the write')
  }
  return {
    load(account, noteId) {
      const list = read()[acctKey(account)] ?? []
      return list.find((r) => r.noteId === noteId) ?? null
    },
    save(rec) {
      const m = read()
      const k = acctKey(rec.account)
      const list = (m[k] ?? []).filter((r) => r.noteId !== rec.noteId)
      list.unshift({ ...rec })
      // Keep every open record; trim only finished ones.
      const open = list.filter((r) => r.phase !== 'done')
      const done = list.filter((r) => r.phase === 'done')
      m[k] = [...open, ...done.slice(0, Math.max(0, MAX_RECORDS_PER_ACCOUNT - open.length))]
      write(m)
    },
    remove(account, noteId) {
      const m = read()
      const k = acctKey(account)
      m[k] = (m[k] ?? []).filter((r) => r.noteId !== noteId)
      try {
        write(m)
      } catch {
        /* a stale dead record only blocks; it can never cause a burn */
      }
    },
    listOpen(account) {
      return (read()[acctKey(account)] ?? [])
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

function isAlreadyKnown(msg: string): boolean {
  return /already|exists|txn-already|duplicate/i.test(msg)
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

  let rec = d.store.load(p.account, noteId)
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
        'Falcon Ledger refuses the same amount to the same address twice — change the amount by at least 1 sat.',
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
  if (!rec) {
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
          `Falcon Ledger already has a burn for ${amount} sats to ${dest} from this account (note ${noteId.slice(0, 12)}…). ` +
            'No new burn was made. Resume it only if you have not already received that BTC.',
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
      step('Found your FBTC burn on Falcon Ledger — resuming at Kickoff (no new burn)…')
    }
  }

  // ── 1. Fresh burn: save BEFORE submit so any failure is resumable. ──
  if (!rec) {
    // Never start a new burn blind: with no local record, an earlier unfinished
    // withdrawal (different amount/address) is only visible on-chain.
    if (chain === null) {
      throw new Error(
        'Could not check Falcon Ledger for an earlier unfinished BTC Bridge out. No burn was made — try again shortly.',
      )
    }
    const unknownOthers = (chain as ChainBtcWithdraw[]).filter(
      (w) => w.noteId !== noteId && d.store.load(p.account, w.noteId)?.phase !== 'done',
    )
    if (unknownOthers.length > 0) {
      const ok = d.confirmFreshBurn ? await d.confirmFreshBurn(unknownOthers) : false
      if (!ok) {
        const list = unknownOthers
          .slice(0, 3)
          .map((w) => `${w.amountSats} sats to ${w.externalTo}`)
          .join('; ')
        throw new Error(
          `Falcon Ledger shows earlier BTC Bridge outs from this account that this browser has no record of (${list}). ` +
            'If one is unfinished, resume it by entering that same amount. No new burn was made.',
        )
      }
    }
    const snap = await d.accountSnap()
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
      d.store.remove(rec.account, rec.noteId)
      throw new Error(
        'The earlier burn never sealed and can no longer apply (its sequence was used by another transaction). ' +
          'No FBTC was burned for it. Press Bridge out again to start fresh.',
      )
    }
    if (sealed === 'pending') {
      note('burn not sealed yet')
      throw new Error(
        'Burn is signed, but Falcon Ledger has not confirmed it sealed yet. Press Bridge out again later with the ' +
          'same amount — it re-uses the same signed burn and cannot burn twice.',
      )
    }
    save({ phase: 'burned', lastError: undefined })
  }

  // ── 3. Kickoff: request once, then always re-broadcast the same tx. ──
  // The coordinator only SIGNS the Kickoff; this client is the only party that
  // broadcasts it. A Kickoff whose response was lost never reached Bitcoin, so
  // asking again while still `burned` cannot pay twice. Once a signed Kickoff
  // is in hand it is persisted before broadcast and reused from then on.
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
    let kickoffTxid = ''
    try {
      kickoffTxid = await btcTxidFromRaw(kick.signed_btc_tx)
    } catch {
      /* broadcast result will supply it */
    }
    save({
      phase: 'kickoff_signed',
      signedKickoffHex: kick.signed_btc_tx,
      kickoffTxid: kickoffTxid || undefined,
      claimSats: Number(kick.amount ?? amount),
      lastError: undefined,
    })
  }

  if (rec.phase === 'kickoff_signed') {
    step('Broadcasting dest-lock Kickoff to Bitcoin testnet…')
    let txid = rec.kickoffTxid ?? ''
    try {
      const got = (await d.broadcast(rec.signedKickoffHex as string)).trim()
      if (/^[0-9a-f]{64}$/i.test(got)) txid = got.toLowerCase()
    } catch (e) {
      const msg = errMsg(e)
      if (isInputsGone(msg)) {
        // Our Kickoff's input was spent by a different tx. If our Kickoff is not
        // itself confirmed it can never confirm, so a fresh Kickoff is safe.
        // Unknown (no txid / lookup failed) must NOT be read as "never confirms".
        let confs: number | null = null
        try {
          confs = txid ? await d.pollConfirmations(txid) : null
        } catch {
          confs = null
        }
        if (confs === null) {
          note(msg)
          throw new Error(
            `FBTC is burned and the Kickoff is signed, but Bitcoin reported its input as spent (${msg}) and its ` +
              'status could not be checked. Press Bridge out again later with the same amount — it re-checks the ' +
              'same Kickoff, no new burn.',
          )
        }
        if (confs > 0) {
          save({ phase: 'kickoff_broadcast', kickoffTxid: txid, lastError: undefined })
        } else {
          save({
            phase: 'burned',
            signedKickoffHex: undefined,
            kickoffTxid: undefined,
            lastError: msg,
          })
          throw new Error(
            `FBTC is burned, but the signed Kickoff's Bitcoin input was already spent (${msg}). ` +
              'Press Bridge out again with the same amount to get a new Kickoff — no new burn.',
          )
        }
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
    if (rec.phase === 'kickoff_signed' && !txid) {
      note('Kickoff txid unknown')
      throw new Error('Kickoff broadcast but its txid is unknown. Press Bridge out again to resume — no new burn.')
    }
    if (rec.phase === 'kickoff_signed') {
      save({ phase: 'kickoff_broadcast', kickoffTxid: txid, lastError: undefined })
    }
  }

  // ── 4. CSV wait then dest take. ──
  if (rec.phase === 'kickoff_broadcast') {
    const kickoffTxid = rec.kickoffTxid as string
    const need = p.claimCsv
    const t0 = d.now()
    let confs = 0
    while (d.now() - t0 < t.kickoffWaitMs) {
      try {
        confs = await d.pollConfirmations(kickoffTxid)
      } catch {
        /* explorer blip */
      }
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
      take = await d.requestTake(kickoffTxid, Number(rec.claimSats ?? amount))
    } catch (e) {
      note(errMsg(e))
      throw new Error(
        `Kickoff is confirmed but the take failed (${errMsg(e)}). Press Bridge out again with the same amount ` +
          'to retry the take — no new burn.',
      )
    }
    // Only mark the withdrawal done once the take is known to be on Bitcoin.
    let takeTxid = String(take.take_txid ?? '').trim().toLowerCase()
    if (!takeTxid && take.signed_btc_tx) {
      try {
        takeTxid = (await d.broadcast(take.signed_btc_tx)).trim().toLowerCase()
      } catch (e) {
        const msg = errMsg(e)
        if (!isAlreadyKnown(msg)) {
          note(msg)
          throw new Error(
            isInputsGone(msg)
              ? `The take was refused because the Kickoff output is already spent (${msg}). Check that BTC arrived ` +
                  `at ${dest} (Kickoff ${kickoffTxid}). No new burn will be made.`
              : `Kickoff is confirmed but the take broadcast failed (${msg}). Press Bridge out again with the same ` +
                  'amount to retry the take — no new burn.',
          )
        }
        try {
          takeTxid = await btcTxidFromRaw(take.signed_btc_tx)
        } catch {
          takeTxid = ''
        }
      }
    }
    if (!/^[0-9a-f]{64}$/.test(takeTxid)) {
      note('take returned no txid')
      throw new Error(
        'Kickoff is confirmed but the take returned no Bitcoin transaction. Press Bridge out again with the same ' +
          'amount to retry the take — no new burn.',
      )
    }
    // Payout is done; a failed write here must not report an error. Worst case
    // a retry asks for the take again, which cannot spend the Kickoff twice.
    rec = { ...rec, phase: 'done', takeTxid, lastError: undefined, updatedAt: d.now() }
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
      d.onStep?.('Waiting for Falcon Ledger to confirm the burn…')
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
    d.onStep?.('Waiting for Falcon Ledger to seal the burn…')
    await d.sleep(t.burnPollMs)
  }
  return 'pending'
}
