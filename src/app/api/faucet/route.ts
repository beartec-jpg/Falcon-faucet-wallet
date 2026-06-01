// POST /api/faucet
// Body: { account: string }
// Returns: { txHash, amount, account, reset } | { error, reset? }

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, refundRateLimit } from '@/lib/rate-limit'
import { getAccountInfo, getLedgerIndex, submitTx } from '@/lib/rpc'
import { signPayment, dropsFromQxrp } from '@/lib/xrpl-sign'
import { isValidClassicAddress } from 'ripple-address-codec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FAUCET_ACCOUNT = process.env.FAUCET_ACCOUNT ?? ''
const FAUCET_SECRET  = process.env.FAUCET_SECRET  ?? ''
const DRIP_AMOUNT    = parseFloat(process.env.DRIP_AMOUNT_QXRP ?? '100')

if (!FAUCET_ACCOUNT || !FAUCET_SECRET) {
  console.error('[faucet] FATAL: FAUCET_ACCOUNT and FAUCET_SECRET must be set (use the funded genesis account)')
}

function ip(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

function err(msg: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: msg, ...extra }, { status })
}

// Simple origin allow-list (M-3)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

function isOriginAllowed(req: NextRequest): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true
  const origin = req.headers.get('origin') || req.headers.get('referer') || ''
  return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed))
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let account: string
  try {
    const body = await req.json()
    account = (body.account ?? '').toString().trim()
  } catch {
    return err('Invalid JSON body')
  }

  if (!account) return err('Missing "account" field')
  if (!isValidClassicAddress(account)) return err('Invalid qXRP address')

  // ── Rate limit: by IP and by destination account ──────────────────────────
  const clientIp = ip(req)
  const [ipLimit, acctLimit] = await Promise.all([
    checkRateLimit(`ip:${clientIp}`),
    checkRateLimit(`acct:${account}`),
  ])

  if (!ipLimit.success) {
    return err(
      'Rate limit exceeded for your IP. Try again later.',
      429,
      { reset: ipLimit.reset }
    )
  }
  if (!acctLimit.success) {
    return err(
      'Rate limit exceeded for this account. Try again later.',
      429,
      { reset: acctLimit.reset }
    )
  }

  // ── Validate faucet configuration ─────────────────────────────────────────
  if (!FAUCET_ACCOUNT || !FAUCET_SECRET) {
    console.error('Faucet FAUCET_ACCOUNT / FAUCET_SECRET not configured')
    return err('Faucet not configured', 500)
  }

  // ── Fetch current sequence + ledger (from the faucet's own account) ─────
  let sequence: number
  let lastLedgerSequence: number
  try {
    const [acctInfo, ledger] = await Promise.all([
      getAccountInfo(FAUCET_ACCOUNT),
      getLedgerIndex(),
    ])
    sequence = acctInfo.account_data.Sequence
    lastLedgerSequence = ledger + 10
  } catch (e: any) {
    const msg = String(e?.message || e)
    console.error('RPC error fetching faucet account info:', msg)
    if (msg.includes('actNotFound') || msg.includes('Account not found')) {
      return err('Faucet account is not funded on this network. Contact operator.', 503)
    }
    return err('Cannot reach qXRP node. Try again shortly.', 503)
  }

  // ── Sign and submit ───────────────────────────────────────────────────────
  const amountDrops = dropsFromQxrp(DRIP_AMOUNT)
  let tx_blob: string
  let txHash: string
  try {
    const signed = await signPayment({
      from: FAUCET_ACCOUNT,
      secret: FAUCET_SECRET,
      to: account,
      amountDrops,
      sequence,
      lastLedgerSequence,
    })
    tx_blob = signed.tx_blob
    txHash  = signed.hash
  } catch (e) {
    console.error('Signing error:', e)
    // Refund rate limit — signing failed before any funds moved
    await Promise.allSettled([
      refundRateLimit(`ip:${clientIp}`),
      refundRateLimit(`acct:${account}`),
    ])
    return err('Transaction signing failed', 500)
  }

  let engineResult: string
  let engineMsg: string
  try {
    const result = await submitTx(tx_blob)
    engineResult = result.engine_result
    engineMsg    = result.engine_result_message
    txHash       = result.tx_json?.hash ?? txHash
  } catch (e: any) {
    const realError = e?.message || String(e)
    console.error('Submit error from node:', realError)
    // Refund rate limit — submission failed before funds moved
    await Promise.allSettled([
      refundRateLimit(`ip:${clientIp}`),
      refundRateLimit(`acct:${account}`),
    ])
    return err(`Transaction submission failed: ${realError}`, 503)
  }

  // tesSUCCESS or terQUEUED are acceptable
  const accepted = engineResult.startsWith('tes') || engineResult === 'terQUEUED'
  if (!accepted) {
    return err(`Transaction rejected: ${engineResult} — ${engineMsg}`, 422)
  }

  return NextResponse.json({
    txHash,
    amount: DRIP_AMOUNT,
    account,
    engine_result: engineResult,
    reset: acctLimit.reset,
  })
}
