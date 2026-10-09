// GET /api/watcher/btc-next
// Next real Bitcoin testnet3 header after the Falcon PL BTC rail tip, for a
// browser-signed `rail_header` (watcher work). Read-only: this route never signs
// or submits. Returns `next: null` when the rail is already at the Bitcoin tip
// (the header daemon usually keeps it there).

import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { plRpc } from '@/lib/pl-rpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ESPLORA = (
  process.env.FALCON_BTC_ESPLORA?.trim() ||
  'https://mempool.space/testnet/api,https://blockstream.info/testnet/api'
)
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean)

function rev(hex: string): string {
  return (hex.match(/../g) ?? []).reverse().join('')
}

function parseBtcHeader(raw: string) {
  const h = raw.trim().toLowerCase()
  if (!/^[0-9a-f]{160}$/.test(h)) throw new Error('header must be 80 bytes hex')
  const bytes = Buffer.from(h, 'hex')
  const d1 = createHash('sha256').update(bytes).digest()
  const d2 = createHash('sha256').update(d1).digest()
  return {
    raw: h,
    hash: Buffer.from(d2).reverse().toString('hex'),
    parentHash: rev(h.slice(8, 72)),
    merkleRoot: rev(h.slice(72, 136)),
    time: bytes.readUInt32LE(68),
  }
}

async function esplora(path: string): Promise<string> {
  let last: Error | null = null
  for (const base of ESPLORA) {
    try {
      const r = await fetch(`${base}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
      if (r.status === 404) return ''
      if (!r.ok) throw new Error(`${base}${path} → ${r.status}`)
      return (await r.text()).trim()
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e))
    }
  }
  throw last ?? new Error('no esplora endpoint')
}

export async function GET() {
  try {
    const r = await plRpc({ type: 'status_req', include_accounts: false, brief: true })
    if (r.type === 'err') throw new Error(String(r.msg ?? 'status error'))
    const rails = Array.isArray(r.body?.rails) ? (r.body!.rails as Array<Record<string, unknown>>) : []
    const btc = rails.find((x) => String(x.asset ?? '') === 'BTC')
    const railTip = Number(btc?.tip_height ?? 0)
    const railHash = String(btc?.tip_hash ?? '').toLowerCase()
    if (!railTip || !railHash) throw new Error('BTC rail tip not available')

    const chainTip = Number(await esplora('/blocks/tip/height'))
    const height = railTip + 1
    const base = { ok: true, railTip, railHash, chainTip: Number.isFinite(chainTip) ? chainTip : null }
    if (Number.isFinite(chainTip) && chainTip < height) {
      return NextResponse.json({ ...base, next: null, reason: 'rail is at the Bitcoin testnet tip' })
    }
    const hash = (await esplora(`/block-height/${height}`)).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return NextResponse.json({ ...base, next: null, reason: `no block at ${height} yet` })
    }
    const header = parseBtcHeader(await esplora(`/block/${hash}/header`))
    if (header.hash !== hash) throw new Error('header hash mismatch from explorer')
    if (header.parentHash !== railHash) {
      return NextResponse.json({
        ...base,
        next: null,
        reason: `rail tip ${railTip} is not the parent of Bitcoin block ${height} (fork or reorg); the header daemon resolves this`,
      })
    }
    return NextResponse.json({ ...base, next: { height, ...header } })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'btc-next failed' },
      { status: 502 },
    )
  }
}
