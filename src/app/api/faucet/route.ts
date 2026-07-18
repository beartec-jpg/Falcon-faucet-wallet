// POST /api/faucet
// Body: { account: string, network?: 'testnet' | 'mainnet' }

import { NextRequest, NextResponse } from 'next/server'
import {
  consumeFaucetQuota,
  faucetUtcDay,
  hashIp,
  logFaucetClaim,
  peekFaucetQuota,
} from '@/lib/faucet-quota'
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
  // Testnet: no daily/cooldown caps (people actively testing). Mainnet keeps quotas.
  const unlimitedTestnet =
    networkKey === 'testnet' &&
    (process.env.TESTNET_FAUCET_UNLIMITED ?? 'true').toLowerCase() !== 'false'

  const unlimitedOk = {
    success: true as const,
    reason: 'ok' as const,
    remainingToday: 999_999,
    claimsToday: 0,
  }

  const [ipLimit, acctLimit] = unlimitedTestnet
    ? [unlimitedOk, unlimitedOk]
    : await Promise.all([
        peekFaucetQuota(`${ratePrefix}ip:${clientIp}`),
        peekFaucetQuota(`${ratePrefix}acct:${account}`),
      ])

  if (!ipLimit.success) {
    const why =
      ipLimit.reason === 'cooldown'
        ? `Wait at least 1 hour between faucet claims (IP). Try again after ${ipLimit.cooldownEndsAt ?? ipLimit.reset}.`
        : `Daily faucet limit reached for your IP (${ipLimit.claimsToday ?? 5}/5 today). Resets at next UTC midnight.`
    return err(why, 429, {
      reset: ipLimit.reset,
      limitType: 'ip',
      reason: ipLimit.reason,
      remainingToday: ipLimit.remainingToday,
    })
  }
  if (!acctLimit.success) {
    const why =
      acctLimit.reason === 'cooldown'
        ? `Wait at least 1 hour between faucet claims. Try again after ${acctLimit.cooldownEndsAt ?? acctLimit.reset}.`
        : `Daily faucet limit reached for this address (${acctLimit.claimsToday ?? 5}/5 today). Come back tomorrow (UTC) for more — daily returns help airdrop score.`
    return err(why, 429, {
      reset: acctLimit.reset,
      limitType: 'account',
      reason: acctLimit.reason,
      remainingToday: acctLimit.remainingToday,
      claimsToday: acctLimit.claimsToday,
    })
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
    const msg = String(e instanceof Error ? e.message : e)
    console.error('Signing error:', msg)
    if (msg.includes('ALLOW_INSECURE_TRANSPORT') || msg.includes('must use https://')) {
      return err(
        'Signer proxy uses HTTP — set ALLOW_INSECURE_TRANSPORT=true in Vercel, then redeploy.',
        500,
      )
    }
    if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
      return err('Signer proxy rejected the token — check SIGNER_PROXY_TOKEN matches the coordinator.', 500)
    }
    if (msg.includes('Secret does not match account')) {
      return err(
        'Faucet secret does not match TESTNET_FAUCET_ACCOUNT — use rwzhiWW4… + falcon_secret from faucet.json.',
        500,
      )
    }
    if (msg.includes('Invalid falcon_secret')) {
      return err(
        'Faucet secret is invalid or truncated — paste the full falcon_secret (~4300 chars, no quotes/newlines).',
        500,
      )
    }
    if (msg.includes('SIGNER_PROXY_URL is not configured')) {
      return err('SIGNER_PROXY_URL is not set in Vercel.', 500)
    }
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

  if (!unlimitedTestnet) {
    await Promise.all([
      consumeFaucetQuota(`${ratePrefix}ip:${clientIp}`),
      consumeFaucetQuota(`${ratePrefix}acct:${account}`),
    ])
  }

  const dayUtc = faucetUtcDay()
  const ipHash = await hashIp(clientIp)
  await logFaucetClaim({
    network: networkKey,
    address: account,
    amountQxrp: faucet.dripAmountQxrp,
    txHash,
    ipHash,
    dayUtc,
  })

  const remaining = unlimitedTestnet
    ? 999_999
    : Math.max(0, (acctLimit.remainingToday ?? 5) - 1)
  return NextResponse.json({
    txHash,
    amount: faucet.dripAmountQxrp,
    account,
    network: networkKey,
    engine_result: validatedResult,
    remainingToday: remaining,
    claimsToday: unlimitedTestnet ? (acctLimit.claimsToday ?? 0) + 1 : (acctLimit.claimsToday ?? 0) + 1,
    cooldownSeconds: unlimitedTestnet ? 0 : 3600,
    unlimited: unlimitedTestnet || undefined,
  })
}