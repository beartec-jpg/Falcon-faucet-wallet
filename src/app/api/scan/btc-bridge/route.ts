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
  /** COMPLETE found on BTC but BTCWithdrawProve not yet on Falcon */
  paidUnproven?: boolean
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
  try {
    const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))
    const net = getNetwork(networkKey)
    if (net.networkId === 2300) {
      const { plStatus } = await import('@/lib/pl-rpc')
      const fileCfg = await loadJsonConfig('btc-spv-bridge.json')
      const st = await plStatus(false)
      const rails = (st.rails as Array<Record<string, unknown>> | undefined) ?? []
      const btc = rails.find((r) => String(r.asset) === 'BTC') ?? {}
      const { loadZeroPoint, offsetRail } = await import('@/lib/pl-zero-point')
      const zp = await loadZeroPoint()
      const off = offsetRail(
        zp,
        'BTC',
        Number(btc.total_minted ?? 0),
        Number(btc.total_burned ?? 0),
      )
      return NextResponse.json({
        checked_at: new Date().toISOString(),
        btcNetwork: 'testnet',
        ready: String(btc.spv) === 'bitcoin',
        message: 'Falcon PL 2300 BTC rail',
        amendment: { name: 'FalconPL', supported: true, enabled: true },
        falcon: {
          ledger: Number(st.tip_height ?? st.height ?? 0),
          tipHeight: Number(btc.tip_height ?? 0),
          tipHash: btc.tip_hash ?? null,
          minConfirmations: Number(btc.min_confirmations ?? 6),
          watchScriptHash: null,
          totalMintedSats: off.minted,
          totalMintedBtc: off.minted / 1e8,
          mintCapSats: null,
          chainId: 2300,
        },
        bitcoin: { tipHeight: null, tipHash: null, explorer: 'https://mempool.space/testnet' },
        headers: {
          falconTipHeight: Number(btc.tip_height ?? 0),
          bitcoinTipHeight: null,
          lagBlocks: null,
          synced: String(btc.spv) === 'bitcoin',
          note: 'Header submitter must stay within 256 blocks of Bitcoin tip',
        },
        reserve: {
          holdAddress: fileCfg.watch_address ?? null,
          holdConfirmedSats: 0,
          holdConfirmedBtc: 0,
          holdUtxoCount: 0,
          holdMatureUtxoCount: 0,
          challengeCsv: 0,
          model: 'falcon-pl-2300',
          watchMatchesConfig: true,
        },
        tvl: {
          valueLockedSats: off.minted - off.burned,
          valueLockedBtc: 0,
        },
      })
    }
    return NextResponse.json(
      {
        error: 'Falcon Ledger (network 1001) BTC bridge scan is retired. Use Falcon PL 2300.',
        retired: true,
      },
      { status: 410 },
    )

  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'btc-bridge suite failed' },
      { status: 500 },
    )
  }
}
