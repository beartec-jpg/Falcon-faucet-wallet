import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveNetworkKey } from '@/lib/network-server'
import { getNetwork } from '@/lib/networks'

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

export async function GET(req: NextRequest) {
  try {
    const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
    const net = getNetwork(networkKey)
    const rpcUrl = process.env.XRPLD_RPC_URL?.trim() || net.rpcUrl || DEFAULT_RPC
    const fileCfg = await loadFileConfig()

    // Amendment
    let amendment = {
      name: FEATURE,
      hash: undefined as string | undefined,
      supported: false,
      enabled: false,
      vetoed: null as boolean | null,
    }
    try {
      const feat = await falconRpc('feature', { feature: FEATURE }, rpcUrl)
      if (feat.error === 'badFeature') {
        amendment.supported = false
      } else {
        for (const [k, v] of Object.entries(feat)) {
          if (k === 'status' || typeof v !== 'object' || !v) continue
          const o = v as Record<string, unknown>
          if (o.name === FEATURE || k.length === 64) {
            amendment = {
              name: FEATURE,
              hash: k.length === 64 ? k : undefined,
              supported: !!o.supported,
              enabled: !!o.enabled,
              vetoed: typeof o.vetoed === 'boolean' ? o.vetoed : null,
            }
            break
          }
        }
      }
    } catch {
      /* RPC flaky */
    }

    // Bridge state SLE
    let activated = false
    let bridge: Record<string, unknown> | undefined
    if (amendment.enabled || amendment.supported) {
      try {
        const le = await falconRpc(
          'ledger_entry',
          { btc_bridge_state: true, ledger_index: 'validated' },
          rpcUrl,
        )
        if (!le.error && le.node && typeof le.node === 'object') {
          activated = true
          const n = le.node as Record<string, unknown>
          bridge = {
            tipHeight: n.BtcTipHeight ?? n.btcTipHeight,
            tipHash: n.BtcTipHash ?? n.btcTipHash,
            minConfirmations: n.BtcMinConfirmations ?? n.btcMinConfirmations,
            watchScriptHash: n.BtcWatchScriptHash ?? n.btcWatchScriptHash,
            mintCap: String(n.BtcMintCap ?? n.btcMintCap ?? ''),
            totalMinted: String(n.BtcTotalMinted ?? n.btcTotalMinted ?? ''),
            chainId: n.BtcChainId ?? n.btcChainId,
          }
        }
      } catch {
        /* not activated */
      }
    }

    const btcNetwork = (String(fileCfg.btc_network || process.env.BTC_NETWORK || 'testnet') ===
    'mainnet'
      ? 'mainnet'
      : 'testnet') as BtcNetwork

    // Protocol shared reserve (keyless hold SPK) — product deposit target
    let protocol: Record<string, unknown> | undefined
    try {
      const raw = await readFile(
        path.join(process.cwd(), 'public', 'config', 'protocol-reserve.json'),
        'utf8',
      )
      protocol = JSON.parse(raw) as Record<string, unknown>
    } catch {
      protocol = undefined
    }

    const paymentScriptHex =
      (fileCfg.payment_script_hex as string | undefined)?.trim() ||
      (protocol?.hold_script_pubkey as string | undefined)?.trim() ||
      process.env.BTC_SPV_PAYMENT_SCRIPT_HEX?.trim() ||
      null

    const watchAddress =
      (fileCfg.watch_address as string | undefined)?.trim() ||
      (protocol?.hold_address as string | undefined)?.trim() ||
      process.env.BTC_SPV_WATCH_ADDRESS?.trim() ||
      process.env.NEXT_PUBLIC_BTC_SPV_WATCH_ADDRESS?.trim() ||
      null

    const watchScriptHash =
      (bridge?.watchScriptHash as string | undefined) ||
      (fileCfg.watch_script_hash as string | undefined) ||
      (protocol?.watch_script_hash as string | undefined) ||
      null

    const ready = amendment.enabled && activated && !!(watchAddress || paymentScriptHex)
    let message: string
    if (!amendment.supported) {
      message = 'Fleet binary missing BitcoinSPVBridge — upgrade validators first'
    } else if (!amendment.enabled) {
      message = 'Amendment BitcoinSPVBridge supported but not enabled yet (waiting majority)'
    } else if (!activated) {
      message = 'Amendment on — bridge not activated yet (ops: BTCBridgeActivate)'
    } else if (!watchAddress && !paymentScriptHex) {
      message = 'Bridge live — set protocol-reserve hold SPK in public/config/'
    } else {
      message =
        'SPV peg-in ready → protocol shared reserve (keyless hold program)'
    }

    return NextResponse.json({
      amendment,
      activated,
      bridge,
      watchAddress,
      paymentScriptHex,
      watchScriptHash,
      protocol: protocol
        ? {
            model: protocol.model,
            watch_script_hash: protocol.watch_script_hash,
            hold_script_pubkey: protocol.hold_script_pubkey,
            challenge_csv: protocol.challenge_csv,
          }
        : undefined,
      btcNetwork,
      ready,
      message,
      mode: ready ? 'spv' : amendment.enabled ? 'spv-pending-ops' : 'waiting-amendment',
    })
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
    action !== 'find_redeem'
  ) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  // Locate COMPLETE payout: FBTO || AccountID20 || seq_be32 + amount to payout script
  if (action === 'find_redeem') {
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
          const bh = t.status?.block_height
          const confs =
            t.status?.confirmed && bh && tip ? Math.max(1, tip - bh + 1) : t.status?.confirmed ? 1 : 0
          return NextResponse.json({
            txid: t.txid,
            confirmations: confs,
            blockHeight: bh,
            matched: { fbto: true, amount: hasPay },
          })
        }
      }
      return NextResponse.json(
        { error: 'Redeem not found yet — fleet redeemer pays after burn' },
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

    if (!confirmed || !status.status?.block_hash) {
      return NextResponse.json(
        {
          error: 'BTC tx not confirmed yet — wait for a block (deposit is fine)',
          confirmed: false,
          confirmations: 0,
          waiting: true,
        },
        { status: 409 },
      )
    }

    // Peg-in only: vout must pay the shared hold. Peg-out COMPLETE pays the user.
    const purpose = body.purpose === 'redeem' ? 'redeem' : 'deposit'
    if (purpose === 'deposit') {
      const fileCfg = await loadFileConfig()
      const watchAddress =
        (fileCfg.watch_address as string | undefined)?.trim() ||
        process.env.BTC_SPV_WATCH_ADDRESS?.trim() ||
        null
      const outAddr = status.vout?.[vout]?.scriptpubkey_address?.trim()
      if (watchAddress && outAddr && outAddr !== watchAddress) {
        return NextResponse.json(
          {
            error:
              `This BTC tx (vout ${vout}) paid ${outAddr}, not the live SPV watch address ${watchAddress}. ` +
              'Claim FBTC only works for deposits to the current protocol hold address. Old mxuam… deposits cannot be claimed on this bridge.',
            wrongWatchAddress: true,
            paidTo: outAddr,
            expectedWatch: watchAddress,
          },
          { status: 400 },
        )
      }
    }

    // Falcon must already have the Bitcoin header for this block or engine returns tecNO_ENTRY
    const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
    const net = getNetwork(networkKey)
    const rpcUrl = process.env.XRPLD_RPC_URL?.trim() || net.rpcUrl || DEFAULT_RPC
    let falconTipHeight = 0
    let headerReady = false
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
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Proof fetch failed' },
      { status: 502 },
    )
  }
}
