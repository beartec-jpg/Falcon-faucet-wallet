import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * FBTC bridge config + claim registration.
 *
 * Production ops: set FBTC_CLAIMS_FILE to coordinator path (or post claims via
 * ops webhook). Local/dev uses .data/fbtc_claims.json under cwd.
 *
 * Flow: wallet sends BTC to custody, then POST claim { falcon, txid, amountSats }.
 * Relay verifies explorer + mints FBTC — no WBTC in product UI.
 */

const FALCON_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const TXID_RE = /^[0-9a-fA-F]{64}$/

function claimsPath(): string {
  return (
    process.env.FBTC_CLAIMS_FILE?.trim() ||
    process.env.BTC_CLAIMS_FILE?.trim() ||
    path.join(process.cwd(), '.data', 'fbtc_claims.json')
  )
}

async function loadClaims(): Promise<{ pending: Record<string, unknown> }> {
  try {
    const raw = await readFile(claimsPath(), 'utf8')
    const j = JSON.parse(raw) as { pending?: Record<string, unknown> }
    return { pending: j.pending ?? {} }
  } catch {
    return { pending: {} }
  }
}

async function saveClaims(data: { pending: Record<string, unknown> }): Promise<void> {
  const p = claimsPath()
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function loadStaticConfig() {
  // Prefer public config; fallback constants match coordinator deploy
  return {
    status: 'live' as const,
    network: (process.env.BTC_NETWORK || 'testnet') as 'testnet' | 'mainnet',
    custody_testnet:
      process.env.FBTC_CUSTODY_TESTNET?.trim() ||
      'mxuamPnEtoMaiRnBnAUnrCZeXTYPVX4hik',
    custody_mainnet:
      process.env.FBTC_CUSTODY_MAINNET?.trim() ||
      '1JPdULhG5mvKwKJa4bWR2HMKfTwgbReTqE',
    falcon: {
      symbol: 'FBTC',
      currency: 'BTC',
      token_issuer:
        process.env.FBTC_ISSUER?.trim() ||
        'rnvzCKcBU7G8Kb9JXHwEKTHiK9aTrZAqWT',
    },
    note: 'One Bridge action: send multi-chain BTC to custody → relay mints FBTC. No WBTC in wallet.',
  }
}

/** GET — public custody address + issuer (no secrets). */
export async function GET() {
  try {
    // Optional: merge from public/config if present
    let fileCfg: Record<string, unknown> = {}
    try {
      const raw = await readFile(
        path.join(process.cwd(), 'public', 'config', 'fbtc-bridge.json'),
        'utf8',
      )
      fileCfg = JSON.parse(raw) as Record<string, unknown>
    } catch {
      /* optional */
    }
    const base = loadStaticConfig()
    const btc = (fileCfg.bitcoin ?? fileCfg.btc ?? {}) as Record<string, string>
    const falcon = (fileCfg.falcon ?? {}) as Record<string, string>
    return NextResponse.json({
      ...base,
      custody_testnet: btc.custody_testnet || base.custody_testnet,
      custody_mainnet: btc.custody_mainnet || base.custody_mainnet,
      falcon: {
        symbol: falcon.token_symbol || base.falcon.symbol,
        currency: falcon.token_currency || base.falcon.currency,
        token_issuer: falcon.token_issuer || base.falcon.token_issuer,
      },
      status: (fileCfg.status as string) || base.status,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'config unavailable' },
      { status: 500 },
    )
  }
}

/**
 * POST — register a deposit claim after the user broadcast a BTC send to custody.
 * Body: { falcon_account, btc_txid, amount_sats }
 */
export async function POST(req: NextRequest) {
  let body: {
    falcon_account?: string
    btc_txid?: string
    amount_sats?: number | string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const falcon = (body.falcon_account || '').trim()
  const txid = (body.btc_txid || '').trim().toLowerCase()
  const amount_sats = Math.floor(Number(body.amount_sats))

  if (!FALCON_RE.test(falcon)) {
    return NextResponse.json({ error: 'Invalid Falcon address' }, { status: 400 })
  }
  if (!TXID_RE.test(txid)) {
    return NextResponse.json({ error: 'Invalid Bitcoin txid' }, { status: 400 })
  }
  if (!Number.isFinite(amount_sats) || amount_sats < 546) {
    return NextResponse.json({ error: 'amount_sats too small (dust)' }, { status: 400 })
  }

  // Prefer coordinator claims intake (testnet default if env unset)
  const remote =
    process.env.FBTC_CLAIMS_WEBHOOK?.trim() ||
    process.env.NEXT_PUBLIC_FBTC_CLAIMS_WEBHOOK?.trim() ||
    'http://46.224.0.140:8099/claim'
  const claim_id = txid
  const claimBody = {
    falcon_account: falcon,
    btc_txid: txid,
    amount_sats,
  }

  // Prefer coordinator claims intake so the mint relay sees it
  if (remote) {
    try {
      const r = await fetch(remote, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.FBTC_CLAIMS_WEBHOOK_TOKEN
            ? { Authorization: `Bearer ${process.env.FBTC_CLAIMS_WEBHOOK_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(claimBody),
      })
      if (r.ok) {
        const j = (await r.json().catch(() => ({}))) as { claim_id?: string }
        return NextResponse.json({
          ok: true,
          claim_id: j.claim_id || txid,
          message: 'Claim registered — FBTC mints after relay verifies the BTC tx',
        })
      }
      // fall through to local queue if webhook fails (dev)
    } catch {
      /* fall through */
    }
  }

  const claims = await loadClaims()
  if (claims.pending[claim_id]) {
    return NextResponse.json({
      ok: true,
      claim_id,
      message: 'Claim already registered',
      duplicate: true,
    })
  }

  claims.pending[claim_id] = {
    ...claimBody,
    queued_at: new Date().toISOString(),
  }
  await saveClaims(claims)

  return NextResponse.json({
    ok: true,
    claim_id,
    message:
      'Claim registered. Relay mints FBTC once the BTC payment to custody is seen (usually under a minute on testnet).',
  })
}
