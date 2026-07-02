// POST /api/faucet
// Body: { account: string, network?: 'testnet' | 'mainnet' }

import { NextRequest, NextResponse } from 'next/server'
import { peekRateLimit, consumeRateLimit } from '@/lib/rate-limit'
import { signPayment, dropsFromQxrp } from '@/lib/xrpl-sign'
import { isOriginAllowed } from '@/lib/origin'
import { isValidClassicAddress } from 'ripple-address-codec'
import {
  resolveFaucet,
  resolveNetworkKey,
  serverNetworkConfig,
  serverRpcCall,
  serverSignerProxy,
} from '@/lib/network-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  let account: string
  let networkKey = 'testnet' as ReturnType<typeof resolveNetworkKey>
  try {
    const body = await req.json()
    account = (body.account ?? '').toString().trim()
    networkKey = resolveNetworkKey(body.network)
  } catch {
    return err('Invalid JSON body')
  }

  const cfg = serverNetworkConfig(networkKey)
  if (!cfg.live) {
    return err(`${cfg.name} faucet is not live yet.`, 503)
  }

  if (!account) return err('Missing "account" field')
  if (!isValidClassicAddress(account)) return err('Invalid Falcon address')

  const clientIp = ip(req)
  const ratePrefix = `${networkKey}:`
  const [ipLimit, acctLimit] = await Promise.all([
    peekRateLimit(`${ratePrefix}ip:${clientIp}`),
    peekRateLimit(`${ratePrefix}acct:${account}`),
  ])

  if (!ipLimit.success) {
    return err(
      `Rate limit exceeded for your IP (${ipLimit.remaining ?? 0} left). Try again after reset.`,
      429,
      { reset: ipLimit.reset, limitType: 'ip' },
    )
  }
  if (!acctLimit.success) {
    return err(
      `Rate limit exceeded for this address (${acctLimit.remaining ?? 0} left). Try again after reset.`,
      429,
      { reset: acctLimit.reset, limitType: 'account' },
    )
  }

  const faucet = resolveFaucet(networkKey)
  if (!faucet) {
    console.error(`[faucet] ${networkKey} FAUCET_ACCOUNT / FAUCET_SECRET not configured`)
    return err('Faucet not configured for this network', 500)
  }

  const proxy = serverSignerProxy(networkKey)

  let sequence: number
  let lastLedgerSequence: number
  try {
    const [acctInfo, srvR] = await Promise.all([
      serverRpcCall<{ account_data: { Sequence: number } }>(networkKey, 'account_info', {
        account: faucet.account,
        ledger_index: 'validated',
      }),
      serverRpcCall<{ info: { validated_ledger?: { seq: number } } }>(networkKey, 'server_info', {}),
    ])
    sequence = acctInfo.account_data.Sequence
    lastLedgerSequence = (srvR.info.validated_ledger?.seq ?? 0) + 30
  } catch (e: unknown) {
    const msg = String(e instanceof Error ? e.message : e)
    console.error('RPC error fetching faucet account info:', msg)
    if (msg.includes('actNotFound') || msg.includes('Account not found')) {
      return err('Faucet account is not funded on this network. Contact operator.', 503)
    }
    return err('Cannot reach Falcon Ledger node. Try again shortly.', 503)
  }

  const amountDrops = dropsFromQxrp(faucet.dripAmountQxrp)
  let tx_blob: string
  let txHash: string
  try {
    const signed = await signPayment({
      from: faucet.account,
      secret: faucet.secret,
      to: account,
      amountDrops,
      sequence,
      lastLedgerSequence,
      networkId: cfg.networkId,
      proxyUrl: proxy?.url,
      proxyToken: proxy?.token,
    })
    tx_blob = signed.tx_blob
    txHash = signed.hash
  } catch (e) {
    console.error('Signing error:', e)
    return err('Transaction signing failed', 500)
  }

  let engineResult: string
  let engineMsg: string
  try {
    const result = await serverRpcCall<{
      engine_result: string
      engine_result_message: string
      tx_json?: { hash?: string }
    }>(networkKey, 'submit', { tx_blob })
    engineResult = result.engine_result
    engineMsg = result.engine_result_message
    txHash = result.tx_json?.hash ?? txHash
  } catch (e: unknown) {
    console.error('Submit error from node:', e)
    return err('Transaction submission failed. Try again shortly.', 503)
  }

  if (engineResult !== 'tesSUCCESS') {
    return err(`Transaction rejected: ${engineResult} — ${engineMsg}`, 422)
  }

  const deadline = Date.now() + 45_000
  let validated = false
  let validatedResult: string | undefined
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000))
    try {
      const tx = await serverRpcCall<{
        validated?: boolean
        meta?: { TransactionResult?: string }
      }>(networkKey, 'tx', { transaction: txHash })
      if (tx?.validated) {
        validated = true
        validatedResult = tx?.meta?.TransactionResult
        break
      }
    } catch {
      /* keep polling */
    }
  }

  if (!validated || validatedResult !== 'tesSUCCESS') {
    return err(
      'Payment was submitted but did not confirm on the ledger. No funds were sent — try again shortly.',
      503,
      { txHash, engine_result: validatedResult ?? 'pending_or_failed' },
    )
  }

  await Promise.all([
    consumeRateLimit(`${ratePrefix}ip:${clientIp}`),
    consumeRateLimit(`${ratePrefix}acct:${account}`),
  ])

  return NextResponse.json({
    txHash,
    amount: faucet.dripAmountQxrp,
    account,
    network: networkKey,
    engine_result: validatedResult,
    reset: acctLimit.reset,
  })
}