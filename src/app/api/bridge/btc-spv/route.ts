import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveNetworkKey } from '@/lib/network-server'
import { getNetwork } from '@/lib/networks'
import { verifyBitcoinMerkleProof } from '@/lib/btc-merkle'
import {
  assertLiveWatchAddress,
  claimAllowedForDeposit,
  isRetiredWatchAddress,
} from '@/lib/btc-spv-policy'

/**
 * Bitcoin SPV light-client bridge status + claim proof helper.
 *
 * GET  — amendment / activation / tip / watch address for portal UI
 * POST — { action: "proof", btc_txid, network?, vout? } → merkle materials for BTCDepositClaim
 */

const FEATURE = 'BitcoinSPVBridge'
const DEFAULT_RPC = process.env.XRPLD_RPC_URL?.trim() || 'http://46.224.0.140:6005'

type BtcNetwork = 'testnet' | 'mainnet'

const EXPLORERS: Record<BtcNetwork, string[]> = {
  testnet: [
    'https://blockstream.info/testnet/api',
    'https://mempool.space/testnet/api',
  ],
  mainnet: ['https://blockstream.info/api', 'https://mempool.space/api'],
}

async function falconRpc(method: string, params: Record<string, unknown> = {}, rpcUrl?: string) {
  const url = rpcUrl || DEFAULT_RPC
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  })
  if (!r.ok) throw new Error(`Falcon RPC HTTP ${r.status}`)
  const j = (await r.json()) as {
    result?: Record<string, unknown> & { error?: string; error_message?: string }
  }
  return j.result || {}
}

/**
 * Falcon JSON encodes custom UInt64 fields as hex (no 0x), e.g. "c350" = 50000
 * and "2710" = 10000 — never parse digit-only strings as decimal.
 */
function parseSatsField(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string') {
    const s = v.trim().replace(/^0x/i, '')
    if (!s) return 0
    if (/^[0-9a-fA-F]+$/i.test(s)) return parseInt(s, 16)
  }
  return 0
}

function mapWithdrawNode(
  node: Record<string, unknown>,
  currentLedger: number,
): {
  account: string
  burnSeq: number
  status: number
  amountSats: number
  challengeEndLedger: number
  currentLedger: number
  ready: boolean
  btcProven: boolean
  burnCommit?: string
  btcTxId?: string
  payoutScript?: string
  phase: 'challenge' | 'awaiting_btc' | 'btc_proven' | 'complete' | 'unknown'
} {
  const challengeEnd = Number(node.BtcChallengeEndLedger ?? 0)
  const status = Number(node.BtcWithdrawStatus ?? 0)
  const amountSats = parseSatsField(node.BtcWithdrawAmount)
  const commit = String(node.BtcBurnCommit || '')
    .replace(/^0x/i, '')
    .toUpperCase()
  const btcTxId = String(node.BtcTxID || node.BtcTxId || '')
    .replace(/^0x/i, '')
    .toLowerCase()
  // Proven when reverse-SPV recorded a redeem txid OR burn commit digest
  const btcProven =
    (!!commit && !/^0+$/.test(commit)) || (!!btcTxId && !/^0+$/.test(btcTxId))
  // Engine: 0=pending, 2=finalized, 3=paid after BTCWithdrawProve (tesSUCCESS)
  const isComplete = status === 2 || status === 3
  const ready = currentLedger > challengeEnd && (status === 0 || isComplete)
  let phase: 'challenge' | 'awaiting_btc' | 'btc_proven' | 'complete' | 'unknown' = 'unknown'
  if (isComplete) phase = 'complete'
  else if (currentLedger <= challengeEnd) phase = 'challenge'
  else if (btcProven) phase = 'btc_proven'
  else if (status === 0) phase = 'awaiting_btc'
  return {
    account: String(node.Account || ''),
    burnSeq: Number(node.BtcWithdrawSeq ?? 0),
    status,
    amountSats,
    challengeEndLedger: challengeEnd,
    currentLedger,
    ready,
    btcProven,
    burnCommit: commit || undefined,
    btcTxId: btcTxId || undefined,
    payoutScript: node.BtcPayoutScript ? String(node.BtcPayoutScript) : undefined,
    phase,
  }
}

async function loadFileConfig(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', 'config', 'btc-spv-bridge.json'),
      'utf8',
    )
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function explorerGet(pathSuffix: string, network: BtcNetwork): Promise<Response> {
  let lastErr: unknown
  for (const base of EXPLORERS[network]) {
    try {
      const r = await fetch(`${base}${pathSuffix}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      })
      if (r.ok || r.status === 404) return r
      lastErr = new Error(`${base}: HTTP ${r.status}`)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Bitcoin explorer unavailable')
}

function isPl2300Request(req: NextRequest): boolean {
  return getNetwork(resolveNetworkKey(req.nextUrl.searchParams.get('network'))).networkId === 2300
}

/** FALC dest id: classic AccountID or sha256(lowercase name)[:20]. */
async function falcDest20(account: string): Promise<Buffer | null> {
  const trimmed = account.trim()
  if (!trimmed) return null
  try {
    const { decodeAccountID } = await import('ripple-address-codec')
    const id = decodeAccountID(trimmed)
    if (id.length === 20) return Buffer.from(id)
  } catch {
    /* named FPL account */
  }
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(trimmed.toLowerCase()).digest().subarray(0, 20)
}

export async function GET(req: NextRequest) {
  try {
    const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
    const net = getNetwork(networkKey)

    if (net.networkId === 2300) {
      const { plStatus } = await import('@/lib/pl-rpc')
      const fileCfg = await loadFileConfig()
      const st = await plStatus(false)
      const rails = (st.rails as Array<Record<string, unknown>> | undefined) ?? []
      const btc = rails.find((r) => String(r.asset) === 'BTC') ?? {}
      const vp = (btc.vault_pub as Record<string, unknown> | undefined) ?? {}
      const watchAddress = String(
        btc.vault_address ||
          vp.address ||
          (fileCfg.watch_address as string | undefined) ||
          '',
      ).trim()
      const paymentScriptHex = String(
        vp.spk_hex || (fileCfg.payment_script_hex as string | undefined) || '',
      )
        .trim()
        .replace(/^0x/i, '')
      if (
        !watchAddress ||
        /tb1q7dnl/i.test(watchAddress) ||
        /tb1qesum/i.test(watchAddress) ||
        /tb1pq9mgl/i.test(watchAddress)
      ) {
        return NextResponse.json(
          {
            ready: false,
            error: 'BTC vault is not the live NUMS dest+watch pool — refusing retired holds',
            watchAddress: '',
            retired: true,
          },
          { status: 503 },
        )
      }
      const tipHeight = Number(btc.tip_height ?? 0)
      const minConf = Number(btc.min_confirmations ?? 6) || 6
      const spv = String(btc.spv ?? 'protocol') === 'bitcoin' ? 'bitcoin' : 'protocol'
      let btcTipHeight: number | null = null
      let btcTipHash: string | null = null
      try {
        const tipH = await explorerGet('/blocks/tip/height', 'testnet')
        if (tipH.ok) btcTipHeight = parseInt(await tipH.text(), 10) || null
        const tipHashR = await explorerGet('/blocks/tip/hash', 'testnet')
        if (tipHashR.ok) btcTipHash = (await tipHashR.text()).trim() || null
      } catch {
        /* explorer lag */
      }
      const lagBlocks =
        tipHeight > 0 && btcTipHeight != null ? Math.max(0, btcTipHeight - tipHeight) : null
      const lagLevel =
        lagBlocks == null ? 'unknown' : lagBlocks >= 100 ? 'critical' : lagBlocks >= 20 ? 'warn' : 'ok'
      return NextResponse.json({
        amendment: { supported: true, enabled: true, majority: true },
        activated: true,
        ready: spv === 'bitcoin',
        mode: spv === 'bitcoin' ? 'bitcoin-spv' : 'pl-rail',
        spv,
        message:
          spv === 'bitcoin'
            ? 'Falcon PL Bitcoin SPV — send testnet BTC to the hold + FALC memo, then mint after 6 confirmations'
            : 'Header submitter has not reanchored onto Bitcoin yet',
        btcNetwork: 'testnet',
        watchAddress,
        paymentScriptHex,
        rail: {
          asset: 'BTC',
          tip_height: tipHeight,
          tip_hash: String(btc.tip_hash ?? ''),
          lock_id: String(btc.lock_id ?? ''),
          min_confirmations: minConf,
          total_minted: Number(btc.total_minted ?? 0),
          total_burned: Number(btc.total_burned ?? 0),
          open_withdrawals: Number(btc.open_withdrawals ?? 0),
          withdrawals: btc.withdrawals ?? [],
          spv,
        },
        bridge: {
          tipHeight,
          tipHash: String(btc.tip_hash ?? ''),
          minConfirmations: minConf,
          lockId: String(btc.lock_id ?? ''),
          totalMinted: String(btc.total_minted ?? 0),
        },
        headers: {
          falconTipHeight: tipHeight || null,
          bitcoinTipHeight: btcTipHeight,
          bitcoinTipHash: btcTipHash,
          lagBlocks,
          lagLevel,
          claimSafe: lagLevel === 'ok' || lagLevel === 'warn',
          lagWarnBlocks: 20,
          lagCriticalBlocks: 100,
        },
      })
    }
    return NextResponse.json(
      {
        error: 'Falcon Ledger (network 1001) is shut down. Use Falcon PL 2300.',
        retired: true,
      },
      { status: 410 },
    )

  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'SPV status failed' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  let body: {
    action?: string
    btc_txid?: string
    network?: BtcNetwork
    vout?: number
    account?: string
    seq?: number
    amount_sats?: number
    /** "deposit" (default) requires vout → watch address; "redeem" is peg-out COMPLETE */
    purpose?: 'deposit' | 'redeem'
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action || 'proof'
  if (
    action !== 'proof' &&
    action !== 'status' &&
    action !== 'withdraw_status' &&
    action !== 'withdraw_list' &&
    action !== 'find_redeem' &&
    action !== 'list_deposits'
  ) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // Open FALC peg-ins for an account (restore tracker if browser storage was lost)
  if (action === 'list_deposits') {
    const account = (body.account || '').trim()
    const network: BtcNetwork = body.network === 'mainnet' ? 'mainnet' : 'testnet'
    if (!account) {
      return NextResponse.json({ error: 'Need Falcon account' }, { status: 400 })
    }
    try {
      const acc20 = await falcDest20(account)
      if (!acc20) {
        return NextResponse.json({ error: 'Need Falcon account' }, { status: 400 })
      }
      const want = Buffer.concat([Buffer.from('FALC'), acc20])
      const fileCfg = await loadFileConfig()
      const hold =
        (fileCfg.watch_address as string | undefined)?.trim() ||
        process.env.BTC_SPV_WATCH_ADDRESS?.trim() ||
        ''
      if (!hold) {
        return NextResponse.json({ deposits: [], error: 'No hold address configured' })
      }
      const tipR = await explorerGet('/blocks/tip/height', network)
      const tip = tipR.ok ? parseInt(await tipR.text(), 10) || 0 : 0
      const txsR = await explorerGet(`/address/${hold}/txs`, network)
      if (!txsR.ok) {
        return NextResponse.json({ deposits: [] })
      }
      const txs = (await txsR.json()) as Array<{
        txid: string
        status?: { confirmed?: boolean; block_height?: number }
        vout?: Array<{
          value?: number
          scriptpubkey?: string
          scriptpubkey_address?: string
        }>
      }>
      const deposits: Array<{
        txid: string
        vout: number
        amountSats: number
        confirmations: number
      }> = []
      for (const t of txs.slice(0, 40)) {
        const st = t.status || {}
        const h = st.block_height || 0
        const confs =
          st.confirmed && h && tip ? Math.max(1, tip - h + 1) : st.confirmed ? 1 : 0
        let falcMatch = false
        let holdVout = -1
        let holdVal = 0
        for (let i = 0; i < (t.vout || []).length; i++) {
          const o = t.vout![i]
          const spk = (o.scriptpubkey || '').replace(/^0x/i, '')
          if (spk.startsWith('6a')) {
            try {
              const buf = Buffer.from(spk, 'hex')
              let payload: Buffer
              if (buf.length >= 2 && buf[1] <= 75) {
                payload = buf.subarray(2, 2 + buf[1])
              } else if (buf.length >= 3 && buf[1] === 0x4c) {
                payload = buf.subarray(3, 3 + buf[2])
              } else {
                payload = buf.subarray(2)
              }
              if (payload.equals(want)) falcMatch = true
            } catch {
              /* ignore */
            }
          }
          if (o.scriptpubkey_address === hold) {
            holdVout = i
            holdVal = Math.floor(Number(o.value || 0))
          }
        }
        if (!falcMatch || holdVout < 0 || holdVal < 546) continue
        // only unspent on Bitcoin (hold keeps the UTXO after claim — that alone ≠ open claim)
        try {
          const osR = await explorerGet(`/tx/${t.txid}/outspend/${holdVout}`, network)
          if (osR.ok) {
            const os = (await osR.json()) as { spent?: boolean }
            if (os.spent) continue
          }
        } catch {
          /* include if outspend check fails */
        }
        // Old Falcon Ledger deposit objects are gone with network 1001.
        deposits.push({
          txid: t.txid,
          vout: holdVout,
          amountSats: holdVal,
          confirmations: confs,
        })
      }
      return NextResponse.json({ deposits, hold, account })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'list_deposits failed', deposits: [] },
        { status: 500 },
      )
    }
  }

  if (action === 'find_redeem') {
    return NextResponse.json(
      { error: 'Falcon Ledger redeem is retired. Use Falcon PL 2300.', retired: true },
      { status: 410 },
    )
  }
  if (false && action === 'find_redeem_retired') {
    const account = (body.account || '').trim()
    const seq = Math.floor(Number(body.seq ?? 0))
    const network: BtcNetwork = body.network === 'mainnet' ? 'mainnet' : 'testnet'
    if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account) || seq < 1) {
      return NextResponse.json({ error: 'Need account + seq' }, { status: 400 })
    }
    try {
      // classic → account id 20
      const { decodeAccountID } = await import('ripple-address-codec')
      const acc20 = Buffer.from(decodeAccountID(account))
      const fbto = Buffer.concat([
        Buffer.from('FBTO'),
        acc20,
        Buffer.from([(seq >>> 24) & 0xff, (seq >>> 16) & 0xff, (seq >>> 8) & 0xff, seq & 0xff]),
      ])
      const fbtoHex = fbto.toString('hex')

      // Prefer payout script + amount from live withdraw object (hex UInt64)
      let payoutScript = ''
      let amountSats = Math.floor(Number(body.amount_sats ?? 0))
      try {
        const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
        const net = getNetwork(networkKey)
        const rpcUrl = process.env.XRPLD_RPC_URL?.trim() || net.rpcUrl || DEFAULT_RPC
        const wRes = await falconRpc(
          'ledger_entry',
          { btc_withdrawal: { account, seq }, ledger_index: 'validated' },
          rpcUrl,
        )
        const node = (wRes.node || {}) as Record<string, unknown>
        const onChainAmt = parseSatsField(node.BtcWithdrawAmount)
        if (onChainAmt > 0) amountSats = onChainAmt
        payoutScript = String(node.BtcPayoutScript || '')
          .replace(/^0x/i, '')
          .toLowerCase()
      } catch {
        /* ignore */
      }

      const fileCfg = await loadFileConfig()
      const hold =
        (fileCfg.watch_address as string | undefined) ||
        process.env.BTC_SPV_WATCH_ADDRESS ||
        'tb1q40fswfaq0e5nvnmayutp7qw3s0r0ctgy62p48w0k4zq79wx6w27s6ulwpv'

      // Scan recent spend txs from hold address (COMPLETE spends hold UTXOs)
      const txsR = await explorerGet(`/address/${hold}/txs`, network)
      if (!txsR.ok) {
        return NextResponse.json({ error: 'Explorer unavailable' }, { status: 502 })
      }
      const txs = (await txsR.json()) as Array<{
        txid: string
        status?: { confirmed?: boolean; block_height?: number }
        vout?: Array<{ value?: number; scriptpubkey?: string; scriptpubkey_address?: string }>
        vin?: Array<{ prevout?: { scriptpubkey_address?: string } }>
      }>

      let tip = 0
      try {
        const tipR = await explorerGet('/blocks/tip/height', network)
        if (tipR.ok) tip = parseInt(await tipR.text(), 10) || 0
      } catch {
        /* ignore */
      }

      for (const t of txs) {
        const vouts = t.vout || []
        let hasFbto = false
        let hasPay = false
        for (const v of vouts) {
          const spk = (v.scriptpubkey || '').toLowerCase()
          if (spk.includes(fbtoHex)) hasFbto = true
          if (payoutScript && spk === payoutScript && (v.value || 0) >= (amountSats || 0)) {
            hasPay = true
          }
          // if no payout script, accept any non-hold output matching amount
          if (!payoutScript && amountSats > 0 && (v.value || 0) === amountSats && !spk.startsWith('6a')) {
            hasPay = true
          }
        }
        if (hasFbto && (hasPay || !payoutScript)) {
          const height = Number(t.status?.block_height)
          const confs = t.status?.confirmed
            ? Number.isFinite(height) && tip > 0
              ? Math.max(1, tip - height + 1)
              : 1
            : 0
          return NextResponse.json({
            txid: t.txid,
            confirmations: confs,
            blockHeight: Number.isFinite(height) ? height : undefined,
            matched: { fbto: true, amount: hasPay },
          })
        }
      }
      return NextResponse.json(
        {
          error:
            'Redeem not found yet — fleet redeemer has not paid BTC for this burn (FBTO + amount). Burn remains safe on Falcon.',
          pending: true,
          account,
          seq,
          amountSats: amountSats || undefined,
          hold,
          // true when we loaded a live BtcWithdrawal object
          withdrawOnLedger: !!payoutScript,
        },
        { status: 404 },
      )
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'find_redeem failed' },
        { status: 502 },
      )
    }
  }

  // SPV peg-out: list open/recent BtcWithdrawal objects for tracker UI
  if (action === 'withdraw_list') {
    const account = (body.account || '').trim()
    if (isPl2300Request(req)) {
      try {
        const { plStatus } = await import('@/lib/pl-rpc')
        const st = await plStatus(false)
        const rails = (st.rails as Array<Record<string, unknown>> | undefined) ?? []
        const btc = rails.find((r) => String(r.asset) === 'BTC') ?? {}
        const raw = (btc.withdrawals as Array<Record<string, unknown>> | undefined) ?? []
        const withdrawals = raw
          .filter((w) => !account || String(w.from ?? '') === account)
          .map((w) => ({
            account: String(w.from ?? account),
            burnSeq: 0,
            status: 0,
            amountSats: Number(w.amount ?? 0),
            challengeEndLedger: 0,
            currentLedger: Number(st.tip_height ?? 0),
            ready: false,
            btcProven: false,
            phase: 'awaiting_btc' as const,
            noteId: String(w.note_id ?? ''),
            externalTo: String(w.external_to ?? ''),
          }))
        return NextResponse.json({
          account,
          currentLedger: Number(st.tip_height ?? 0),
          withdrawals,
          mode: 'pl-rail',
        })
      } catch (e: unknown) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'withdraw_list failed', withdrawals: [] },
          { status: 502 },
        )
      }
    }
    return NextResponse.json(
      { error: 'Falcon Ledger withdraw list is retired. Use Falcon PL 2300.', retired: true },
      { status: 410 },
    )
    if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
      return NextResponse.json({ error: 'Need Falcon account' }, { status: 400 })
    }
    try {
      const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
      const net = getNetwork(networkKey)
      const rpcUrl = process.env.XRPLD_RPC_URL?.trim() || net.rpcUrl || DEFAULT_RPC
      const [objRes, srv] = await Promise.all([
        falconRpc(
          'account_objects',
          { account, ledger_index: 'validated', limit: 400, type: 'btc_withdrawal' },
          rpcUrl,
        ),
        falconRpc('server_info', {}, rpcUrl),
      ])
      // type filter may be unsupported — fall back to full objects
      let objects = (objRes.account_objects as Record<string, unknown>[] | undefined) || []
      if (objRes.error || objects.length === 0) {
        const all = await falconRpc(
          'account_objects',
          { account, ledger_index: 'validated', limit: 400 },
          rpcUrl,
        )
        objects = ((all.account_objects as Record<string, unknown>[]) || []).filter(
          (o) => o.LedgerEntryType === 'BtcWithdrawal',
        )
      } else {
        objects = objects.filter((o) => o.LedgerEntryType === 'BtcWithdrawal')
      }
      const info = (srv.info || {}) as { validated_ledger?: { seq?: number } }
      const currentLedger = Number(info.validated_ledger?.seq ?? 0)
      const withdrawals = objects
        .map((n) => mapWithdrawNode(n, currentLedger))
        .sort((a, b) => b.burnSeq - a.burnSeq)
      return NextResponse.json({ account, currentLedger, withdrawals })
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'withdraw_list failed' },
        { status: 502 },
      )
    }
  }

  // SPV peg-out: poll BtcWithdrawal challenge window
  if (action === 'withdraw_status') {
    return NextResponse.json(
      { error: 'Falcon Ledger withdraw status is retired. Use Falcon PL 2300.', retired: true },
      { status: 410 },
    )
    const account = (body.account || '').trim()
    const seq = Math.floor(Number(body.seq ?? 0))
    if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account) || seq < 1) {
      return NextResponse.json({ error: 'Need account + seq (burn sequence)' }, { status: 400 })
    }
    try {
      const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
      const net = getNetwork(networkKey)
      const rpcUrl = process.env.XRPLD_RPC_URL?.trim() || net.rpcUrl || DEFAULT_RPC
      const [wRes, srv] = await Promise.all([
        falconRpc(
          'ledger_entry',
          {
            btc_withdrawal: { account, seq },
            ledger_index: 'validated',
          },
          rpcUrl,
        ),
        falconRpc('server_info', {}, rpcUrl),
      ])
      if (wRes.error === 'entryNotFound' || !wRes.node) {
        return NextResponse.json(
          { error: 'Withdraw object not found yet', ready: false },
          { status: 404 },
        )
      }
      const node = wRes.node as Record<string, unknown>
      const info = (srv.info || {}) as { validated_ledger?: { seq?: number } }
      const currentLedger = Number(info.validated_ledger?.seq ?? 0)
      const mapped = mapWithdrawNode(node, currentLedger)
      return NextResponse.json({
        status: mapped.status,
        challengeEndLedger: mapped.challengeEndLedger,
        currentLedger: mapped.currentLedger,
        amountSats: mapped.amountSats,
        ready: mapped.ready,
        btcProven: mapped.btcProven,
        burnCommit: mapped.burnCommit,
        phase: mapped.phase,
        payoutScript: mapped.payoutScript,
        account: mapped.account || account,
        burnSeq: mapped.burnSeq || seq,
      })
    } catch (e: unknown) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'withdraw_status failed' },
        { status: 502 },
      )
    }
  }

  const txid = (body.btc_txid || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return NextResponse.json({ error: 'Invalid btc_txid' }, { status: 400 })
  }
  const network: BtcNetwork = body.network === 'mainnet' ? 'mainnet' : 'testnet'
  const vout = Math.max(0, Math.floor(Number(body.vout ?? 0)))

  try {
    const statusR = await explorerGet(`/tx/${txid}`, network)
    if (!statusR.ok) {
      if (statusR.status === 404) {
        // Explorer index lag after broadcast — not a failed payment
        return NextResponse.json(
          {
            confirmed: false,
            confirmations: 0,
            waiting: true,
            error: 'Deposit broadcast — explorer still indexing (wait, do not re-send)',
          },
          { status: 404 },
        )
      }
      return NextResponse.json(
        { error: 'Tx status unavailable', waiting: true },
        { status: 502 },
      )
    }
    const status = (await statusR.json()) as {
      status?: { confirmed?: boolean; block_height?: number; block_hash?: string }
      vout?: Array<{ value?: number; scriptpubkey_address?: string }>
    }

    let tip = 0
    try {
      const tipR = await explorerGet('/blocks/tip/height', network)
      if (tipR.ok) tip = parseInt(await tipR.text(), 10) || 0
    } catch {
      /* ignore */
    }

    const blockHeight = status.status?.block_height ?? 0
    const confirmed = !!status.status?.confirmed && !!status.status?.block_hash
    const confirmations =
      confirmed && blockHeight > 0 && tip > 0 ? Math.max(1, tip - blockHeight + 1) : 0

    // Status-only: conf tracking after refresh (no merkle proof required)
    if (action === 'status') {
      return NextResponse.json({
        confirmed,
        confirmations,
        blockHeight: confirmed ? blockHeight : undefined,
        tip: tip || undefined,
        blockHash: status.status?.block_hash?.replace(/^0x/i, ''),
      })
    }

    // Peg-in only: vout must pay the shared hold. Peg-out COMPLETE pays the user.
    const purpose = body.purpose === 'redeem' ? 'redeem' : 'deposit'

    if (!confirmed || !status.status?.block_hash) {
      return NextResponse.json(
        {
          error:
            purpose === 'redeem'
              ? 'Reserve BTC payout is in the mempool or a new block — wait for confirmations, then Prove again. Your FBTC burn is safe.'
              : 'BTC deposit not confirmed yet — wait for a block. Do not re-send BTC.',
          confirmed: false,
          confirmations: 0,
          waiting: true,
          purpose,
        },
        { status: 409 },
      )
    }
    if (purpose === 'deposit') {
      const fileCfg = await loadFileConfig()
      const watchAddress =
        (fileCfg.watch_address as string | undefined)?.trim() ||
        process.env.BTC_SPV_WATCH_ADDRESS?.trim() ||
        null
      const outAddr = status.vout?.[vout]?.scriptpubkey_address?.trim()
      if (outAddr && isRetiredWatchAddress(outAddr)) {
        return NextResponse.json(
          {
            error: `Deposit paid retired watch address ${outAddr}. This bridge no longer claims those deposits.`,
            wrongWatchAddress: true,
            paidTo: outAddr,
            retired: true,
          },
          { status: 400 },
        )
      }
      const watchErr = assertLiveWatchAddress(outAddr, watchAddress)
      if (watchErr) {
        return NextResponse.json(
          {
            error: watchErr,
            wrongWatchAddress: true,
            paidTo: outAddr,
            expectedWatch: watchAddress,
          },
          { status: 400 },
        )
      }
    }

    // 1001 xrpld must already have the Bitcoin header. FPL 2300 checks the
    // rail tip on RailDeposit — return the explorer proof even if the
    // submitter is still catching up.
    const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
    const net = getNetwork(networkKey)
    const rpcUrl = process.env.XRPLD_RPC_URL?.trim() || net.rpcUrl || DEFAULT_RPC
    let falconTipHeight = 0
    let headerReady = isPl2300Request(req)
    if (!headerReady) {
    try {
      const bridgeLe = await falconRpc(
        'ledger_entry',
        { btc_bridge_state: true, ledger_index: 'validated' },
        rpcUrl,
      )
      const bnode = bridgeLe.node as Record<string, unknown> | undefined
      falconTipHeight = Number(bnode?.BtcTipHeight ?? 0) || 0
      const heightLe = await falconRpc(
        'ledger_entry',
        { btc_height: blockHeight, ledger_index: 'validated' },
        rpcUrl,
      )
      headerReady = !heightLe.error && !!heightLe.node
      // Prefer bridge tip when height object lags
      if (!headerReady && falconTipHeight > 0 && blockHeight > 0 && blockHeight <= falconTipHeight) {
        headerReady = true
      }
    } catch {
      /* RPC flaky — still return proof; claim may fail with tecNO_ENTRY */
    }
    }

    if (!headerReady) {
      const gap =
        falconTipHeight > 0 && blockHeight > falconTipHeight
          ? blockHeight - falconTipHeight
          : undefined
      return NextResponse.json(
        {
          error:
            `Falcon SPV headers have not indexed Bitcoin block ${blockHeight} yet` +
            (falconTipHeight ? ` (Falcon tip ~${falconTipHeight}` + (gap ? `, ~${gap} blocks behind` : '') + ')' : '') +
            '. Wait for the header submitter, then Claim FBTC again — do not re-send BTC.',
          waiting: true,
          headerReady: false,
          falconTipHeight: falconTipHeight || undefined,
          depositHeight: blockHeight,
          confirmations,
          confirmed: true,
        },
        { status: 409 },
      )
    }

    const rawR = await explorerGet(`/tx/${txid}/hex`, network)
    if (!rawR.ok) {
      return NextResponse.json(
        { error: 'Raw tx not found — wait for broadcast / explorer index' },
        { status: 404 },
      )
    }
    const rawTxHex = (await rawR.text()).trim().replace(/^0x/i, '')

    const proofR = await explorerGet(`/tx/${txid}/merkle-proof`, network)
    if (!proofR.ok) {
      return NextResponse.json({ error: 'Merkle proof unavailable' }, { status: 502 })
    }
    const proof = (await proofR.json()) as { merkle?: string[]; pos?: number }
    const siblings = proof.merkle ?? []
    // Esplora returns sibling hashes in display (RPC) order. Falcon BTCDepositClaim
    // expects Bitcoin internal byte order in BtcMerkleProof (same as e2e / bitcoind).
    const merkleProofHex = siblings
      .map((h) => {
        const hex = h.toLowerCase().replace(/^0x/i, '')
        if (!/^[0-9a-f]{64}$/.test(hex)) return hex
        return hex.match(/.{2}/g)!.reverse().join('')
      })
      .join('')
    const txIndex = proof.pos ?? 0
    const blockHash = status.status.block_hash.replace(/^0x/i, '')

    // Independent Merkle check vs block header from dual explorers (W1.3 / W1.4)
    let merkleRoot: string | null = null
    try {
      const blockR = await explorerGet(`/block/${blockHash}`, network)
      if (blockR.ok) {
        const block = (await blockR.json()) as { merkle_root?: string }
        merkleRoot = block.merkle_root?.replace(/^0x/i, '').toLowerCase() || null
      }
    } catch {
      /* optional */
    }
    if (merkleRoot) {
      const v = verifyBitcoinMerkleProof({
        txidDisplay: txid,
        merkleProofHex,
        txIndex,
        merkleRootDisplay: merkleRoot,
      })
      if (!v.ok) {
        return NextResponse.json(
          {
            error: `Independent Merkle verify failed: ${v.error || 'mismatch'}. Try again or use another explorer.`,
            merkleVerified: false,
          },
          { status: 502 },
        )
      }
    }

    // Value-tier confs + reorg buffer for deposits (W2)
    if (purpose === 'deposit') {
      const amountSats = Math.floor(Number(status.vout?.[vout]?.value ?? 0))
      const gate = claimAllowedForDeposit({
        depositHeight: blockHeight,
        falconTip: falconTipHeight || null,
        btcTip: tip || null,
        confirmations,
        amountSats,
        protocolMinConf: undefined,
      })
      if (!gate.ok) {
        return NextResponse.json(
          {
            error: gate.reason,
            waiting: true,
            headerReady: true,
            falconTipHeight: falconTipHeight || undefined,
            confirmations,
            minConfirmations: gate.minConf,
            reorgBuffer: gate.reorgBuffer,
            amountSats,
          },
          { status: 409 },
        )
      }
    }

    return NextResponse.json({
      rawTxHex,
      merkleProofHex,
      txIndex,
      blockHash,
      vout,
      confirmations,
      blockHeight,
      confirmed: true,
      headerReady: true,
      falconTipHeight: falconTipHeight || undefined,
      merkleVerified: !!merkleRoot,
      merkleRoot: merkleRoot || undefined,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Proof fetch failed' },
      { status: 502 },
    )
  }
}
