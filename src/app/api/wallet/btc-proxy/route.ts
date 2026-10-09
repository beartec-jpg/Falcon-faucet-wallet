import { NextRequest, NextResponse } from 'next/server'

/**
 * Same-origin Bitcoin explorer proxy (testnet/mainnet).
 * GET  ?op=utxo&address=&network=testnet
 * GET  ?op=tx&txid=&network=testnet
 * GET  ?op=outspend&txid=&vout=&network=testnet  → one answer PER explorer
 * POST { op: 'broadcast', rawHex, network }
 */

const EXPLORERS: Record<string, string[]> = {
  testnet: [
    'https://blockstream.info/testnet/api',
    'https://mempool.space/testnet/api',
  ],
  mainnet: [
    'https://blockstream.info/api',
    'https://mempool.space/api',
  ],
}

async function explorerGet(network: string, path: string): Promise<{ ok: boolean; status: number; text: string }> {
  let last = 'explorer unavailable'
  for (const base of EXPLORERS[network] || EXPLORERS.testnet) {
    try {
      const r = await fetch(`${base}${path}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'falcon-wallet-btc-proxy/1.0',
        },
        cache: 'no-store',
      })
      const text = await r.text()
      if (r.ok || r.status === 404) return { ok: r.ok, status: r.status, text }
      last = `${base}: HTTP ${r.status}`
    } catch (e: unknown) {
      last = e instanceof Error ? e.message : String(e)
    }
  }
  return { ok: false, status: 502, text: last }
}

async function explorerPost(network: string, path: string, body: string): Promise<{ ok: boolean; status: number; text: string }> {
  let last = 'broadcast unavailable'
  for (const base of EXPLORERS[network] || EXPLORERS.testnet) {
    try {
      const r = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'User-Agent': 'falcon-wallet-btc-proxy/1.0',
        },
        body,
        cache: 'no-store',
      })
      const text = await r.text()
      if (r.ok) return { ok: true, status: r.status, text: text.trim() }
      last = text || `${base}: HTTP ${r.status}`
    } catch (e: unknown) {
      last = e instanceof Error ? e.message : String(e)
    }
  }
  return { ok: false, status: 502, text: last }
}

type SpendAnswer = {
  ok: boolean
  spent?: boolean
  txid?: string
  confirmed?: boolean
  blockHeight?: number
  tip?: number
}

/**
 * Ask ONE explorer who spent txid:vout, with that explorer's own tip. No
 * fallback between explorers: the caller needs every answer to compare them.
 */
async function outspendAt(base: string, txid: string, vout: number): Promise<SpendAnswer> {
  const get = async (path: string) => {
    const r = await fetch(`${base}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'falcon-wallet-btc-proxy/1.0' },
      cache: 'no-store',
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.text()
  }
  try {
    const j = JSON.parse(await get(`/tx/${txid}/outspend/${vout}`)) as {
      spent?: boolean
      txid?: string
      status?: { confirmed?: boolean; block_height?: number }
    }
    if (typeof j.spent !== 'boolean') return { ok: false }
    if (!j.spent) return { ok: true, spent: false }
    let tip: number | undefined
    try {
      const n = parseInt(await get('/blocks/tip/height'), 10)
      tip = Number.isFinite(n) && n > 0 ? n : undefined
    } catch {
      tip = undefined
    }
    return {
      ok: true,
      spent: true,
      txid: typeof j.txid === 'string' ? j.txid.toLowerCase() : undefined,
      confirmed: !!j.status?.confirmed,
      blockHeight: typeof j.status?.block_height === 'number' ? j.status.block_height : undefined,
      tip,
    }
  } catch {
    return { ok: false }
  }
}

export async function GET(req: NextRequest) {
  const op = (req.nextUrl.searchParams.get('op') || '').toLowerCase()
  const network = (req.nextUrl.searchParams.get('network') || 'testnet').toLowerCase()
  const net = network === 'mainnet' ? 'mainnet' : 'testnet'

  if (op === 'utxo') {
    const address = (req.nextUrl.searchParams.get('address') || '').trim()
    if (address.length < 26 || address.length > 64) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
    }
    const r = await explorerGet(net, `/address/${encodeURIComponent(address)}/utxo`)
    if (!r.ok) return NextResponse.json({ error: r.text }, { status: 502 })
    try {
      return NextResponse.json({ utxos: JSON.parse(r.text) })
    } catch {
      return NextResponse.json({ error: 'bad utxo json' }, { status: 502 })
    }
  }

  if (op === 'tx') {
    const txid = (req.nextUrl.searchParams.get('txid') || '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      return NextResponse.json({ error: 'Invalid txid' }, { status: 400 })
    }
    const r = await explorerGet(net, `/tx/${txid}`)
    if (!r.ok) return NextResponse.json({ error: r.text }, { status: 502 })
    try {
      return NextResponse.json(JSON.parse(r.text))
    } catch {
      return NextResponse.json({ error: 'bad tx json' }, { status: 502 })
    }
  }

  if (op === 'outspend') {
    const txid = (req.nextUrl.searchParams.get('txid') || '').trim().toLowerCase()
    const vout = Number(req.nextUrl.searchParams.get('vout'))
    if (!/^[0-9a-f]{64}$/.test(txid) || !Number.isInteger(vout) || vout < 0 || vout > 0xffff) {
      return NextResponse.json({ error: 'Invalid outpoint' }, { status: 400 })
    }
    const answers = await Promise.all((EXPLORERS[net] || EXPLORERS.testnet).map((b) => outspendAt(b, txid, vout)))
    return NextResponse.json({ answers })
  }

  return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  let body: { op?: string; rawHex?: string; network?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if ((body.op || '').toLowerCase() !== 'broadcast') {
    return NextResponse.json({ error: 'Unknown op' }, { status: 400 })
  }

  const raw = (body.rawHex || '').replace(/\s+/g, '').toLowerCase()
  if (!/^[0-9a-f]+$/.test(raw) || raw.length < 20) {
    return NextResponse.json({ error: 'Invalid raw transaction hex' }, { status: 400 })
  }
  const net = (body.network || 'testnet').toLowerCase() === 'mainnet' ? 'mainnet' : 'testnet'

  const r = await explorerPost(net, '/tx', raw)
  if (!r.ok) {
    return NextResponse.json({ error: r.text || 'Broadcast failed' }, { status: 502 })
  }
  // explorers return txid as plain text
  return NextResponse.json({ txid: r.text.replace(/"/g, '') })
}
