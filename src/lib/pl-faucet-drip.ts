// Falcon PL 2300 faucet drip — shared by /api/faucet and /api/arcade/claim.
// PL testnet has no xrpld JSON-RPC (account_info/submit); drips go through the
// local pl-ctl seat when present, otherwise the walletd HTTP API.
import { existsSync } from 'fs'
import { isClassicAddress } from '@/lib/classic-address'
import { ctlFaucet, PL_CTL } from '@/lib/pl-ctl'
import { walletApiHeaders, walletApiUrl } from '@/lib/walletd'
import { nameKeyOnFile } from '@/lib/pl-name-store'
import { plKeyCommitHash } from '@/lib/pl-key-commit-server'

export class WalletApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export const PL_DRIP = Number(process.env.FALCON_PL_DRIP ?? '2000') || 2000

export function payToKeyEnabled(): boolean {
  return (process.env.FALCON_PL_FAUCET_PAY_TO_KEY ?? '').trim().toLowerCase() === 'true'
}

export async function faucetViaHttp(to: string, amount: number, publicKey?: string) {
  const r = await fetch(walletApiUrl(), {
    method: 'POST',
    headers: walletApiHeaders(),
    // walletd (FPL_FAUCET_PAY_TO_KEY=1) turns publicKey, or its own name
    // reservation, into a PayToKey commitment (audit C-1).
    body: JSON.stringify({ action: 'faucet', account: to, amount, ...(publicKey ? { publicKey } : {}) }),
  })
  const d = (await r.json().catch(() => ({}))) as { error?: string; txId?: string; raw?: string }
  if (!r.ok) {
    throw new WalletApiError(d.error ?? `wallet api ${r.status}`, r.status)
  }
  const m = String(d.raw ?? '').match(/tx_id=([0-9a-fA-F]+)/)
  return { txId: d.txId || m?.[1] || '' }
}

export type PlDripResult =
  | { ok: true; txId: string; amount: number }
  | { ok: false; status: number; error: string; reason: string }

/** Drip FPL to a PL account (r… or name) on network 2300. */
export async function plFaucetDrip(account: string, amount: number = PL_DRIP): Promise<PlDripResult> {
  const local = existsSync(PL_CTL)
  let keyHash: string | undefined
  if (payToKeyEnabled() && !isClassicAddress(account) && local) {
    const pk = nameKeyOnFile(account)
    if (!pk) {
      return {
        ok: false,
        status: 400,
        reason: 'name_not_reserved',
        error: 'Reserve this name in the wallet first, then claim.',
      }
    }
    keyHash = plKeyCommitHash(pk)
  }
  try {
    const paid = local ? await ctlFaucet(account, amount, keyHash) : await faucetViaHttp(account, amount)
    return { ok: true, txId: paid.txId, amount }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    console.error('[pl-faucet] drip failed:', msg)
    if (e instanceof WalletApiError && e.status === 429) {
      return {
        ok: false,
        status: 429,
        reason: 'walletd_rate_limit',
        error:
          msg.includes('limit') || msg.includes('rate') || msg.includes('day')
            ? msg
            : 'Faucet rate limit reached for this account. Try again tomorrow.',
      }
    }
    return { ok: false, status: 503, reason: 'pl_unreachable', error: 'Cannot reach Falcon PL. Try again shortly.' }
  }
}
