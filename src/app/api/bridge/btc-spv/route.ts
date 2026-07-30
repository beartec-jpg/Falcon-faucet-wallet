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

    const watchAddress =
      (fileCfg.watch_address as string | undefined)?.trim() ||
      process.env.BTC_SPV_WATCH_ADDRESS?.trim() ||
      process.env.NEXT_PUBLIC_BTC_SPV_WATCH_ADDRESS?.trim() ||
      null

    const ready = amendment.enabled && activated && !!watchAddress
    let message: string
    if (!amendment.supported) {
      message = 'Fleet binary missing BitcoinSPVBridge — upgrade validators first'
    } else if (!amendment.enabled) {
      message = 'Amendment BitcoinSPVBridge supported but not enabled yet (waiting majority)'
    } else if (!activated) {
      message = 'Amendment on — bridge not activated yet (ops: BTCBridgeActivate)'
    } else if (!watchAddress) {
      message = 'Bridge live on Falcon — set watch_address in public/config/btc-spv-bridge.json'
    } else {
      message = 'SPV peg-in ready (BTC → FBTC via light client)'
    }

    return NextResponse.json({
      amendment,
      activated,
      bridge,
      watchAddress,
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
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action || 'proof'
  if (action !== 'proof') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }

  const txid = (body.btc_txid || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    return NextResponse.json({ error: 'Invalid btc_txid' }, { status: 400 })
  }
  const network: BtcNetwork = body.network === 'mainnet' ? 'mainnet' : 'testnet'
  const vout = Math.max(0, Math.floor(Number(body.vout ?? 0)))

  try {
    const rawR = await explorerGet(`/tx/${txid}/hex`, network)
    if (!rawR.ok) {
      return NextResponse.json(
        { error: 'Raw tx not found — wait for broadcast / explorer index' },
        { status: 404 },
      )
    }
    const rawTxHex = (await rawR.text()).trim().replace(/^0x/i, '')

    const statusR = await explorerGet(`/tx/${txid}`, network)
    if (!statusR.ok) {
      return NextResponse.json({ error: 'Tx status unavailable' }, { status: 502 })
    }
    const status = (await statusR.json()) as {
      status?: { confirmed?: boolean; block_height?: number; block_hash?: string }
      vout?: Array<{ value?: number; scriptpubkey_address?: string }>
    }
    if (!status.status?.confirmed || !status.status.block_hash) {
      return NextResponse.json(
        { error: 'BTC tx not confirmed yet', confirmed: false },
        { status: 409 },
      )
    }

    const proofR = await explorerGet(`/tx/${txid}/merkle-proof`, network)
    if (!proofR.ok) {
      return NextResponse.json({ error: 'Merkle proof unavailable' }, { status: 502 })
    }
    const proof = (await proofR.json()) as { merkle?: string[]; pos?: number }
    const siblings = proof.merkle ?? []
    const merkleProofHex = siblings.map((h) => h.toLowerCase().replace(/^0x/i, '')).join('')
    const txIndex = proof.pos ?? 0
    const blockHash = status.status.block_hash.replace(/^0x/i, '')
    const blockHeight = status.status.block_height ?? 0

    let confirmations = 1
    try {
      const tipR = await explorerGet('/blocks/tip/height', network)
      if (tipR.ok) {
        const tip = parseInt(await tipR.text(), 10)
        if (Number.isFinite(tip) && blockHeight > 0) {
          confirmations = Math.max(1, tip - blockHeight + 1)
        }
      }
    } catch {
      /* ignore */
    }

    return NextResponse.json({
      rawTxHex,
      merkleProofHex,
      txIndex,
      blockHash,
      vout,
      confirmations,
      blockHeight,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Proof fetch failed' },
      { status: 502 },
    )
  }
}
