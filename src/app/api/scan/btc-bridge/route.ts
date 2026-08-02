import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveNetworkKey } from '@/lib/network-server'
import { getNetwork } from '@/lib/networks'

/**
 * Explorer suite: Bitcoin SPV bridge metrics for /scan Bitcoin Bridge tab.
 * Aggregates Falcon BtcBridgeState, hold UTXOs, header lag, withdrawal activity.
 */

const DEFAULT_RPC = process.env.XRPLD_RPC_URL?.trim() || 'http://46.224.0.140:6005'
const FEATURE = 'BitcoinSPVBridge'

const EXPLORERS = {
  testnet: [
    'https://blockstream.info/testnet/api',
    'https://mempool.space/testnet/api',
  ],
  mainnet: ['https://blockstream.info/api', 'https://mempool.space/api'],
} as const

type BtcNetwork = keyof typeof EXPLORERS

function parseSatsField(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
  if (typeof v === 'string') {
    const s = v.trim().replace(/^0x/i, '')
    if (!s) return 0
    if (/^[0-9a-fA-F]+$/i.test(s)) return parseInt(s, 16)
  }
  return 0
}

async function falconRpc(
  method: string,
  params: Record<string, unknown> = {},
  rpcUrl?: string,
) {
  const url = rpcUrl || DEFAULT_RPC
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`Falcon RPC HTTP ${r.status}`)
  const j = (await r.json()) as {
    result?: Record<string, unknown> & { error?: string }
  }
  return j.result || {}
}

async function explorerGet(pathSuffix: string, network: BtcNetwork): Promise<Response> {
  let lastErr: unknown
  for (const base of EXPLORERS[network]) {
    try {
      const r = await fetch(`${base}${pathSuffix}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      })
      if (r.ok || r.status === 404) return r
      lastErr = new Error(`${base}: HTTP ${r.status}`)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Bitcoin explorer unavailable')
}

async function loadJsonConfig(name: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path.join(process.cwd(), 'public', 'config', name), 'utf8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

type WithdrawRow = {
  account: string
  seq: number
  status: number
  statusLabel: string
  amountSats: number
  amountBtc: string
  phase: string
  challengeEndLedger: number
  inChallengeWindow: boolean
  btcTxId?: string
  hasCommit: boolean
}

function statusLabel(status: number): string {
  if (status === 0) return 'pending'
  if (status === 2) return 'finalized'
  if (status === 3) return 'paid'
  return `status_${status}`
}

function mapWithdraw(
  node: Record<string, unknown>,
  ledger: number,
): WithdrawRow {
  const status = Number(node.BtcWithdrawStatus ?? 0)
  const challengeEnd = Number(node.BtcChallengeEndLedger ?? 0)
  const amountSats = parseSatsField(node.BtcWithdrawAmount)
  const commit = String(node.BtcBurnCommit || '')
    .replace(/^0x/i, '')
    .toUpperCase()
  const btcTxId = String(node.BtcTxID || node.BtcTxId || '')
    .replace(/^0x/i, '')
    .toLowerCase()
  const hasCommit = !!commit && !/^0+$/.test(commit)
  const btcProven = hasCommit || (!!btcTxId && !/^0+$/.test(btcTxId))
  const isComplete = status === 2 || status === 3
  const inChallengeWindow = ledger > 0 && challengeEnd > 0 && ledger <= challengeEnd
  let phase = 'unknown'
  if (isComplete) phase = 'complete'
  else if (inChallengeWindow) phase = 'challenge_window'
  else if (btcProven) phase = 'btc_proven'
  else if (status === 0) phase = 'awaiting_btc'
  return {
    account: String(node.Account || ''),
    seq: Number(node.BtcWithdrawSeq ?? 0),
    status,
    statusLabel: statusLabel(status),
    amountSats,
    amountBtc: (amountSats / 1e8).toFixed(8),
    phase,
    challengeEndLedger: challengeEnd,
    inChallengeWindow,
    btcTxId: btcTxId && !/^0+$/.test(btcTxId) ? btcTxId : undefined,
    hasCommit,
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now()
  try {
    const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
    const net = getNetwork(networkKey)
    const rpcUrl = process.env.XRPLD_RPC_URL?.trim() || net.rpcUrl || DEFAULT_RPC

    const fileCfg = await loadJsonConfig('btc-spv-bridge.json')
    const protocol = await loadJsonConfig('protocol-reserve.json')
    const btcNetwork = (String(fileCfg.btc_network || 'testnet') === 'mainnet'
      ? 'mainnet'
      : 'testnet') as BtcNetwork

    const scanAccounts = (
      process.env.BTC_BRIDGE_SCAN_ACCOUNTS ||
      process.env.SCAN_ACCOUNTS ||
      'r9UxFwYfFJwhVHHGaCLUVrpTQsaXCqiBkK'
    )
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)

    // Amendment
    let amendment = {
      name: FEATURE,
      supported: false,
      enabled: false,
    }
    try {
      const feat = await falconRpc('feature', { feature: FEATURE }, rpcUrl)
      for (const [k, v] of Object.entries(feat)) {
        if (k === 'status' || typeof v !== 'object' || !v) continue
        const o = v as Record<string, unknown>
        if (o.name === FEATURE || k.length === 64) {
          amendment = {
            name: FEATURE,
            supported: !!o.supported,
            enabled: !!o.enabled,
          }
          break
        }
      }
    } catch {
      /* ignore */
    }

    // Falcon ledger tip
    let falconLedger = 0
    try {
      const li = await falconRpc('ledger', { ledger_index: 'validated' }, rpcUrl)
      const ledger = li.ledger as Record<string, unknown> | undefined
      falconLedger = Number(li.ledger_index ?? ledger?.ledger_index ?? 0)
    } catch {
      /* ignore */
    }

    // Bridge state
    let bridge: {
      tipHeight: number
      tipHash: string
      anchorHeight: number
      anchorHash: string
      minConfirmations: number
      watchScriptHash: string
      mintCapSats: number
      totalMintedSats: number
      chainId: number
      mptIssuanceId?: string
    } | null = null

    try {
      const le = await falconRpc(
        'ledger_entry',
        { btc_bridge_state: true, ledger_index: 'validated' },
        rpcUrl,
      )
      if (!le.error && le.node && typeof le.node === 'object') {
        const n = le.node as Record<string, unknown>
        bridge = {
          tipHeight: Number(n.BtcTipHeight ?? 0),
          tipHash: String(n.BtcTipHash ?? ''),
          anchorHeight: Number(n.BtcAnchorHeight ?? 0),
          anchorHash: String(n.BtcAnchorHash ?? ''),
          minConfirmations: Number(n.BtcMinConfirmations ?? 6),
          watchScriptHash: String(n.BtcWatchScriptHash ?? '').toUpperCase(),
          mintCapSats: parseSatsField(n.BtcMintCap),
          totalMintedSats: parseSatsField(n.BtcTotalMinted),
          chainId: Number(n.BtcChainId ?? 1),
          mptIssuanceId: n.MPTokenIssuanceID
            ? String(n.MPTokenIssuanceID)
            : undefined,
        }
      }
    } catch {
      /* not activated */
    }

    const holdAddress =
      (fileCfg.watch_address as string | undefined)?.trim() ||
      (protocol.hold_address as string | undefined)?.trim() ||
      null
    const configWatchHash = String(
      fileCfg.watch_script_hash || protocol.watch_script_hash || '',
    ).toUpperCase()
    const challengeCsv = Number(
      fileCfg.challenge_csv ?? protocol.challenge_csv ?? 16,
    )

    // Bitcoin tip + hold UTXOs
    let btcTipHeight = 0
    let btcTipHash = ''
    let holdConfirmedSats = 0
    let holdUnconfirmedSats = 0
    let holdUtxoCount = 0
    let holdMatureUtxoCount = 0
    let holdMatureSats = 0
    const minConfs = bridge?.minConfirmations ?? 6

    try {
      const tipH = await explorerGet('/blocks/tip/height', btcNetwork)
      btcTipHeight = parseInt((await tipH.text()).trim(), 10) || 0
      if (btcTipHeight > 0) {
        const tipHashR = await explorerGet(`/block-height/${btcTipHeight}`, btcNetwork)
        if (tipHashR.ok) btcTipHash = (await tipHashR.text()).trim()
      }
    } catch {
      /* explorer flaky */
    }

    if (holdAddress) {
      try {
        const ur = await explorerGet(`/address/${holdAddress}/utxo`, btcNetwork)
        if (ur.ok) {
          const utxos = (await ur.json()) as Array<{
            value: number
            status?: { confirmed?: boolean; block_height?: number }
          }>
          holdUtxoCount = utxos.length
          for (const u of utxos) {
            const val = Number(u.value || 0)
            const st = u.status || {}
            if (st.confirmed) {
              holdConfirmedSats += val
              const h = Number(st.block_height || 0)
              const confs =
                h && btcTipHeight ? Math.max(1, btcTipHeight - h + 1) : 1
              if (confs >= minConfs) {
                holdMatureUtxoCount += 1
                holdMatureSats += val
              }
            } else {
              holdUnconfirmedSats += val
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Withdrawals / challenge activity
    const withdrawals: WithdrawRow[] = []
    for (const acct of scanAccounts) {
      try {
        const res = await falconRpc(
          'account_objects',
          { account: acct, ledger_index: 'validated', limit: 400 },
          rpcUrl,
        )
        const objs = (res.account_objects as Record<string, unknown>[]) || []
        for (const o of objs) {
          if (o.LedgerEntryType !== 'BtcWithdrawal') continue
          withdrawals.push(mapWithdraw(o, falconLedger))
        }
      } catch {
        /* skip account */
      }
    }

    const pending = withdrawals.filter((w) => w.status === 0)
    const paid = withdrawals.filter((w) => w.status === 3 || w.status === 2)
    const inChallenge = withdrawals.filter((w) => w.inChallengeWindow)
    const awaitingBtc = withdrawals.filter((w) => w.phase === 'awaiting_btc')
    const pendingSats = pending.reduce((s, w) => s + w.amountSats, 0)
    const paidSats = paid.reduce((s, w) => s + w.amountSats, 0)

    const minted = bridge?.totalMintedSats ?? 0
    // Solvency: hold backs minted + unpaid burns (same as vault_security)
    const requiredSats = minted + pendingSats
    const shortfallSats = Math.max(0, requiredSats - holdConfirmedSats)
    const solvent = holdConfirmedSats >= requiredSats

    const falconTip = bridge?.tipHeight ?? 0
    const headerLag = btcTipHeight > 0 && falconTip > 0 ? btcTipHeight - falconTip : null
    const headersSynced =
      headerLag !== null ? headerLag <= (bridge?.minConfirmations ?? 6) + 2 : null

    const watchMatch =
      !!bridge?.watchScriptHash &&
      !!configWatchHash &&
      bridge.watchScriptHash === configWatchHash

    // Recent activity: open first, then paid with tx, capped
    const activity = [...withdrawals]
      .sort((a, b) => {
        if (a.status !== b.status) return a.status - b.status
        return b.seq - a.seq
      })
      .slice(0, 25)

    return NextResponse.json({
      checked_at: new Date().toISOString(),
      latency_ms: Date.now() - started,
      network: networkKey,
      btcNetwork,
      amendment,
      ready: amendment.enabled && !!bridge && !!holdAddress,
      message: !amendment.enabled
        ? 'BitcoinSPVBridge amendment not enabled'
        : !bridge
          ? 'Bridge state not found on Falcon'
          : solvent
            ? 'SPV bridge live — solvent'
            : 'SPV bridge live — undercollateralized (redeem paused by policy)',
      falcon: {
        ledger: falconLedger,
        tipHeight: falconTip,
        tipHash: bridge?.tipHash || null,
        anchorHeight: bridge?.anchorHeight ?? null,
        anchorHash: bridge?.anchorHash || null,
        minConfirmations: minConfs,
        watchScriptHash: bridge?.watchScriptHash || null,
        chainId: bridge?.chainId ?? null,
        mintCapSats: bridge?.mintCapSats ?? null,
        totalMintedSats: minted,
        totalMintedBtc: minted / 1e8,
        mptIssuanceId: bridge?.mptIssuanceId || null,
      },
      bitcoin: {
        tipHeight: btcTipHeight || null,
        tipHash: btcTipHash || null,
        explorer:
          btcNetwork === 'testnet'
            ? 'https://mempool.space/testnet'
            : 'https://mempool.space',
      },
      headers: {
        falconTipHeight: falconTip || null,
        bitcoinTipHeight: btcTipHeight || null,
        lagBlocks: headerLag,
        synced: headersSynced,
        note:
          headerLag === null
            ? 'Waiting for tips'
            : headerLag <= 0
              ? 'Falcon at or ahead of reported BTC tip (or explorer lag)'
              : `Falcon is ${headerLag} block(s) behind Bitcoin tip`,
      },
      reserve: {
        holdAddress,
        holdConfirmedSats,
        holdConfirmedBtc: holdConfirmedSats / 1e8,
        holdUnconfirmedSats,
        holdUtxoCount,
        holdMatureUtxoCount,
        holdMatureSats,
        challengeCsv,
        model: (fileCfg.model || protocol.model || null) as string | null,
        configWatchHash: configWatchHash || null,
        watchMatchesConfig: watchMatch,
        paymentScriptHex:
          (fileCfg.payment_script_hex as string | undefined) ||
          (protocol.hold_script_pubkey as string | undefined) ||
          null,
      },
      tvl: {
        valueLockedSats: holdConfirmedSats,
        valueLockedBtc: holdConfirmedSats / 1e8,
        fbtcOutstandingSats: minted,
        fbtcOutstandingBtc: minted / 1e8,
        collateralRatio:
          minted > 0 ? Number((holdConfirmedSats / minted).toFixed(4)) : null,
      },
      solvency: {
        ok: solvent,
        requiredSats,
        shortfallSats,
        holdConfirmedSats,
        totalMintedSats: minted,
        openUnpaidBurnsSats: pendingSats,
      },
      challenges: {
        // On-ledger challenge windows (Falcon withdraw objects)
        openChallengeWindows: inChallenge.length,
        pendingPegOuts: pending.length,
        awaitingBtcPayment: awaitingBtc.length,
        paidOrFinalized: paid.length,
        note:
          'Challenge windows are Falcon BtcWithdrawal challenge periods. Live mempool races run on ops challengers (not counted on-ledger).',
      },
      activity: {
        scannedAccounts: scanAccounts,
        totals: {
          withdrawals: withdrawals.length,
          pending: pending.length,
          paid: paid.length,
          inChallengeWindow: inChallenge.length,
          pendingSats,
          paidSats,
        },
        recent: activity,
      },
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'btc-bridge suite failed' },
      { status: 500 },
    )
  }
}
