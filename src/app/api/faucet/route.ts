// POST /api/faucet
// Body: { account: string }
// Returns: { txHash, amount, account, reset } | { error, reset? }

import { NextRequest, NextResponse } from 'next/server'
import { peekRateLimit, consumeRateLimit } from '@/lib/rate-limit'
import { getAccountInfo, getLedgerIndex, getTx, submitTx } from '@/lib/rpc'
import { signPayment, dropsFromQxrp } from '@/lib/xrpl-sign'
import { isOriginAllowed } from '@/lib/origin'
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
  if (!isValidClassicAddress(account)) return err('Invalid Falcon address')

  // ── Rate limit peek (does NOT consume — only successful drips count) ─────
  const clientIp = ip(req)
  const [ipLimit, acctLimit] = await Promise.all([
    peekRateLimit(`ip:${clientIp}`),
    peekRateLimit(`acct:${account}`),
  ])

  if (!ipLimit.success) {
    return err(
      `Rate limit exceeded for your IP (${ipLimit.remaining ?? 0} left). Try again after reset.`,
      429,
      { reset: ipLimit.reset, limitType: 'ip' }
    )
  }
  if (!acctLimit.success) {
    return err(
      `Rate limit exceeded for this address (${acctLimit.remaining ?? 0} left). Try again after reset.`,
      429,
      { reset: acctLimit.reset, limitType: 'account' }
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
    lastLedgerSequence = ledger + 30
  } catch (e: any) {
    const msg = String(e?.message || e)
    console.error('RPC error fetching faucet account info:', msg)
    if (msg.includes('actNotFound') || msg.includes('Account not found')) {
      return err('Faucet account is not funded on this network. Contact operator.', 503)
    }
    return err('Cannot reach Falcon Ledger node. Try again shortly.', 503)
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
    return err('Transaction submission failed. Try again shortly.', 503)
  }

  if (engineResult !== 'tesSUCCESS') {
    return err(`Transaction rejected: ${engineResult} — ${engineMsg}`, 422)
  }

  // Falcon-signed payments can show tesSUCCESS on the open ledger but fail consensus.
  // Poll until validated or the tx expires before counting the drip.
  const deadline = Date.now() + 45_000
  let validated = false
  let validatedResult: string | undefined
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000))
    try {
      const tx = await getTx(txHash)
      if (tx?.validated) {
        validated = true
        validatedResult = tx?.meta?.TransactionResult
        break
      }
    } catch {
      // keep polling
    }
  }

  if (!validated || validatedResult !== 'tesSUCCESS') {
    return err(
      'Payment was submitted but did not confirm on the ledger. No funds were sent — try again shortly.',
      503,
      { txHash, engine_result: validatedResult ?? 'pending_or_failed' },
    )
  }

  // Only consume rate limit after validated success
  await Promise.all([
    consumeRateLimit(`ip:${clientIp}`),
    consumeRateLimit(`acct:${account}`),
  ])

  return NextResponse.json({
    txHash,
    amount: DRIP_AMOUNT,
    account,
    engine_result: validatedResult,
    reset: acctLimit.reset,
  })
}
