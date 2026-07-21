/**
 * Shared faucet payment (same pool for normal + game claims).
 * Server signs with faucet secret and submits to the ledger.
 */

import { signPayment, dropsFromQxrp } from '@/lib/xrpl-sign'
import {
  resolveFaucet,
  serverNetworkConfig,
  serverRpcCall,
  serverSignerProxy,
} from '@/lib/network-server'
import type { NetworkKey } from '@/lib/networks'

export type FaucetPayResult =
  | {
      ok: true
      txHash: string
      amount: number
      account: string
      network: NetworkKey
    }
  | { ok: false; error: string; status: number; extra?: Record<string, unknown> }

export async function sendFaucetDrip(opts: {
  networkKey: NetworkKey
  toAccount: string
  /** Override drip amount; default is network faucet drip. */
  amountQxrp?: number
}): Promise<FaucetPayResult> {
  const cfg = serverNetworkConfig(opts.networkKey)
  if (!cfg.live) {
    return {
      ok: false,
      error: `${cfg.name} faucet is not live yet.`,
      status: 503,
    }
  }

  const faucet = resolveFaucet(opts.networkKey)
  if (!faucet) {
    console.error(
      `[faucet] ${opts.networkKey} FAUCET_ACCOUNT / FAUCET_SECRET not configured`,
    )
    return {
      ok: false,
      error: 'Faucet not configured for this network',
      status: 500,
    }
  }

  const amountQxrp = opts.amountQxrp ?? faucet.dripAmountQxrp
  const proxy = serverSignerProxy(opts.networkKey)

  let sequence: number
  let lastLedgerSequence: number
  try {
    const [acctInfo, srvR] = await Promise.all([
      serverRpcCall<{ account_data: { Sequence: number } }>(
        opts.networkKey,
        'account_info',
        {
          account: faucet.account,
          ledger_index: 'validated',
        },
      ),
      serverRpcCall<{ info: { validated_ledger?: { seq: number } } }>(
        opts.networkKey,
        'server_info',
        {},
      ),
    ])
    sequence = acctInfo.account_data.Sequence
    lastLedgerSequence = (srvR.info.validated_ledger?.seq ?? 0) + 30
  } catch (e: unknown) {
    const msg = String(e instanceof Error ? e.message : e)
    console.error('RPC error fetching faucet account info:', msg)
    if (msg.includes('actNotFound') || msg.includes('Account not found')) {
      return {
        ok: false,
        error:
          'Faucet account is not funded on this network. Contact operator.',
        status: 503,
      }
    }
    return {
      ok: false,
      error: 'Cannot reach Falcon Ledger node. Try again shortly.',
      status: 503,
    }
  }

  const amountDrops = dropsFromQxrp(amountQxrp)
  let tx_blob: string
  let txHash: string
  try {
    const signed = await signPayment({
      from: faucet.account,
      secret: faucet.secret,
      to: opts.toAccount,
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
    // Never surface signer/config hints to clients
    return {
      ok: false,
      error: 'Transaction signing failed',
      status: 500,
    }
  }

  let engineResult: string
  let engineMsg: string
  try {
    const result = await serverRpcCall<{
      engine_result: string
      engine_result_message: string
      tx_json?: { hash?: string }
    }>(opts.networkKey, 'submit', { tx_blob })
    engineResult = result.engine_result
    engineMsg = result.engine_result_message
    txHash = result.tx_json?.hash ?? txHash
  } catch (e: unknown) {
    console.error('Submit error from node:', e)
    return {
      ok: false,
      error: 'Transaction submission failed. Try again shortly.',
      status: 503,
    }
  }

  if (engineResult !== 'tesSUCCESS') {
    console.error('[faucet-pay] rejected', engineResult, engineMsg)
    return {
      ok: false,
      error: 'Transaction rejected by the network. Try again shortly.',
      status: 422,
    }
  }

  const deadline = Date.now() + 45_000
  let validated = false
  let validatedResult: string | undefined
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000))
    try {
      const tx = await serverRpcCall<{
        validated?: boolean
        meta?: { TransactionResult?: string }
      }>(opts.networkKey, 'tx', { transaction: txHash })
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
    return {
      ok: false,
      error:
        'Payment was submitted but did not confirm on the ledger. No funds were sent — try again shortly.',
      status: 503,
      extra: {
        txHash,
        engine_result: validatedResult ?? 'pending_or_failed',
      },
    }
  }

  return {
    ok: true,
    txHash,
    amount: amountQxrp,
    account: opts.toAccount,
    network: opts.networkKey,
  }
}
