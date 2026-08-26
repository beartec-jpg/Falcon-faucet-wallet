import { existsSync } from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { plAccount, plStatus } from '@/lib/pl-rpc'
import { ctlPay, ctlVaultLock, ctlVaultOpen, PL_CTL } from '@/lib/pl-ctl'

const WALLET_API =
  process.env.FALCON_PL_WALLET_API?.trim() || 'http://192.241.247.158:19312'

async function payViaHttp(from: string, to: string, amount: number) {
  const r = await fetch(WALLET_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pay', from, to, amount }),
  })
  const d = (await r.json()) as { error?: string; raw?: string }
  if (!r.ok) throw new Error(d.error ?? `wallet api ${r.status}`)
  const m = String(d.raw ?? '').match(/tx_id=([0-9a-fA-F]+)/)
  return { txId: m?.[1] ?? '', raw: d.raw ?? '' }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NAME_RE = /^[A-Za-z0-9._-]{2,64}$/
const TEST_HINTS = ['alice', 'bob', 'carol', 'dave'] as const

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export async function GET(req: NextRequest) {
  const account = (req.nextUrl.searchParams.get('account') ?? '').trim()
  if (account && !NAME_RE.test(account)) {
    return NextResponse.json({ error: 'Invalid PL account name' }, { status: 400 })
  }
  try {
    const [st, acct] = await Promise.all([
      plStatus(false),
      account ? plAccount(account) : Promise.resolve(null),
    ])
    return NextResponse.json({
      online: true,
      product: st.product_version,
      networkId: st.network_id,
      tip: st.tip_height,
      epoch: st.epoch,
      firstClaimEpoch: st.first_claim_epoch,
      testAccounts: TEST_HINTS,
      account: account
        ? {
            name: account,
            exists: Boolean(acct?.exists),
            balance: num(acct?.balance),
            sequence: num(acct?.sequence),
            claimable: num(acct?.claimable),
            accountType: String(acct?.account_type ?? 'hot'),
            allowlist: Array.isArray(acct?.allowlist) ? (acct?.allowlist as string[]) : [],
            vaultLocked: Boolean(acct?.vault_locked),
          }
        : null,
    })
  } catch (e) {
    return NextResponse.json(
      { online: false, error: String(e instanceof Error ? e.message : e), testAccounts: TEST_HINTS },
      { status: 503 },
    )
  }
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }
  let body: {
    action?: string
    from?: string
    to?: string
    amount?: number | string
    account?: string
    destination?: string
    txHash?: string
    txid?: string
    asset?: string
    dest?: string
    noteId?: string
    externalTo?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = String(body.action ?? 'pay')

  if (action === 'vault-activate') {
    const account = String(body.account ?? body.from ?? '').trim()
    const destination = String(body.destination ?? body.to ?? '').trim()
    if (!NAME_RE.test(account) || !NAME_RE.test(destination)) {
      return NextResponse.json({ error: 'account and destination must be PL names' }, { status: 400 })
    }
    if (account === destination) {
      return NextResponse.json({ error: 'Nominate a different address than the vault itself' }, { status: 400 })
    }
    try {
      const cur = await plAccount(account)
      if (String(cur.account_type ?? 'hot') === 'vault' && cur.vault_locked) {
        return NextResponse.json({ error: 'Vault already locked' }, { status: 400 })
      }
      if (existsSync(PL_CTL)) {
        const open = await ctlVaultOpen(account, destination)
        const seq0 = num(cur.sequence)
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 250))
          const mid = await plAccount(account)
          if (num(mid.sequence) > seq0) break
        }
        const lock = await ctlVaultLock(account)
        const after = await plAccount(account)
        return NextResponse.json({
          ok: true,
          action: 'vault-activate',
          account,
          destination,
          openTx: open.txId,
          lockTx: lock.txId,
          accountType: after.account_type,
          allowlist: after.allowlist,
          vaultLocked: after.vault_locked,
        })
      }
      const r = await fetch(WALLET_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vault-activate', account, destination }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `wallet api ${r.status}`)
      return NextResponse.json(d)
    } catch (e) {
      return NextResponse.json(
        { error: String(e instanceof Error ? e.message : e) },
        { status: 503 },
      )
    }
  }

  if (action === 'header-proof') {
    const height = Number(body.height ?? 0)
    if (!Number.isInteger(height) || height < 1) {
      return NextResponse.json({ error: 'height must be a positive integer' }, { status: 400 })
    }
    try {
      const r = await fetch(WALLET_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'header-proof', height }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `wallet api ${r.status}`)
      return NextResponse.json(d)
    } catch (e) {
      return NextResponse.json(
        { error: String(e instanceof Error ? e.message : e) },
        { status: 503 },
      )
    }
  }

  if (action === 'claim-proof') {
    const account = String(body.account ?? '').trim()
    const dest = String(body.dest ?? '').trim()
    const asset = String(body.asset ?? 'ETH').trim().toUpperCase()
    const noteId = String(body.noteId ?? '').trim()
    const amount = String(body.amount ?? '').trim()
    if (!NAME_RE.test(account)) {
      return NextResponse.json({ error: 'account must be a PL name' }, { status: 400 })
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(dest)) {
      return NextResponse.json({ error: 'dest must be a 20-byte 0x address' }, { status: 400 })
    }
    if (asset !== 'ETH' && asset !== 'USDC') {
      return NextResponse.json({ error: 'asset must be ETH or USDC' }, { status: 400 })
    }
    if (!/^[0-9]+$/.test(amount) || amount === '0') {
      return NextResponse.json({ error: 'amount must be a positive integer' }, { status: 400 })
    }
    try {
      const r = await fetch(WALLET_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim-proof', account, dest, asset, amount, noteId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `wallet api ${r.status}`)
      return NextResponse.json(d)
    } catch (e) {
      return NextResponse.json(
        { error: String(e instanceof Error ? e.message : e) },
        { status: 503 },
      )
    }
  }

  if (action === 'mint-eth-deposit' || action === 'mint-status') {
    const account = String(body.account ?? body.to ?? '').trim()
    const txHash = String(body.txHash ?? body.txid ?? '').trim()
    const asset = String(body.asset ?? '').trim().toUpperCase()
    if (!NAME_RE.test(account)) {
      return NextResponse.json({ error: 'account must be a PL name' }, { status: 400 })
    }
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(txHash)) {
      return NextResponse.json({ error: 'txHash must be 32-byte hex' }, { status: 400 })
    }
    if (asset && asset !== 'ETH' && asset !== 'USDC') {
      return NextResponse.json({ error: 'asset must be ETH or USDC' }, { status: 400 })
    }
    try {
      const r = await fetch(WALLET_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, account, txHash, asset: asset || undefined }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `wallet api ${r.status}`)
      return NextResponse.json(d)
    } catch (e) {
      return NextResponse.json(
        { error: String(e instanceof Error ? e.message : e) },
        { status: 503 },
      )
    }
  }

  if (action === 'btc-kickoff' || action === 'btc-take') {
    const account = String(body.account ?? body.from ?? '').trim()
    const dest = String(body.dest ?? body.externalTo ?? '').trim()
    const amount = String(body.amount ?? '').trim()
    const destSecret = String(body.destSecret ?? '').replace(/^0x/i, '').toLowerCase()
    if (!NAME_RE.test(account)) {
      return NextResponse.json({ error: 'account must be a PL name' }, { status: 400 })
    }
    if (dest.length < 26) {
      return NextResponse.json({ error: 'dest must be a Bitcoin address' }, { status: 400 })
    }
    if (!/^[0-9]+$/.test(amount) || Number(amount) < 10000) {
      return NextResponse.json({ error: 'amount must be ≥ 10000 sats' }, { status: 400 })
    }
    if (!/^[0-9a-f]{64}$/.test(destSecret)) {
      return NextResponse.json({ error: 'destSecret must be 32-byte hex' }, { status: 400 })
    }
    const payload: Record<string, unknown> = {
      action,
      account,
      dest,
      amount,
      destSecret,
    }
    if (action === 'btc-take') {
      payload.prevTxid = String(body.prevTxid ?? '').toLowerCase()
      payload.vout = Number(body.vout ?? 0)
      payload.sats = Number(body.sats ?? amount)
    }
    try {
      const r = await fetch(WALLET_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `wallet api ${r.status}`)
      return NextResponse.json(d)
    } catch (e) {
      return NextResponse.json(
        { error: String(e instanceof Error ? e.message : e) },
        { status: 503 },
      )
    }
  }

  if (action !== 'pay') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  const from = String(body.from ?? '').trim()
  const to = String(body.to ?? '').trim()
  const amount = Math.floor(Number(body.amount ?? 0))
  if (!NAME_RE.test(from) || !NAME_RE.test(to)) {
    return NextResponse.json({ error: 'from/to must be PL account names' }, { status: 400 })
  }
  if (from === to) {
    return NextResponse.json({ error: 'Destination must differ from sender' }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount < 1) {
    return NextResponse.json({ error: 'Amount must be at least 1 FPL' }, { status: 400 })
  }
  try {
    const sender = await plAccount(from)
    if (String(sender.account_type ?? 'hot') === 'vault') {
      const allow = Array.isArray(sender.allowlist) ? sender.allowlist.map(String) : []
      if (!allow.includes(to)) {
        const only = allow[0] ? ` only ${allow[0]}` : ' the nominated address'
        return NextResponse.json(
          { error: `Vault is locked — protocol will only pay${only}` },
          { status: 400 },
        )
      }
    }
    const paid = existsSync(PL_CTL)
      ? await ctlPay(from, to, amount)
      : await payViaHttp(from, to, amount)
    const acct = await plAccount(from)
    return NextResponse.json({
      ok: true,
      txId: paid.txId,
      from,
      to,
      amount,
      balance: num(acct.balance),
      sequence: num(acct.sequence),
    })
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    return NextResponse.json({ error: msg }, { status: 503 })
  }
}
