// /api/watcher
// GET  ?account=   live enter/exit + on-chain presence (read-only, any account)
// POST { action: 'start' | 'stop' | 'heartbeat' | 'claim' }
//
// Watchers sign their own txs in the browser (WatcherPanel: heartbeat, claim
// and BTC rail_header via /api/watcher/btc-next). The server-side POST path
// only exists for local dev with a falcon-pl-ctl binary and only for the
// configured demo watcher account. On Vercel (no ctl) it answers 501.
// `work` / `real-test` (synthetic BTC headers through ctl) are gone: 410.

import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { PL_WATCHER_ACCOUNT } from '@/lib/pl-rpc'
import { ctlAvailable } from '@/lib/pl-ctl'
import {
  beatWatcher,
  claimWatcher,
  startWatcher,
  stopWatcher,
  watcherSnapshot,
} from '@/lib/pl-watcher'

const WALLET_SIGNED =
  'Watcher actions are signed by your wallet in the browser on this site. ' +
  'Open the faucet page, unlock your wallet and press Start watcher / Submit rail work / Claim.'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

function accountOf(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return PL_WATCHER_ACCOUNT
  if (!/^[a-zA-Z0-9._-]{2,64}$/.test(s)) return PL_WATCHER_ACCOUNT
  return s
}

export async function GET(req: NextRequest) {
  const account = accountOf(req.nextUrl.searchParams.get('account'))
  const snap = await watcherSnapshot(account)
  return NextResponse.json(snap, { status: snap.online ? 200 : 503 })
}

function requestOrigin(req: NextRequest): string {
  const origin = req.headers.get('origin')
  if (origin) return origin
  const proto =
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
    req.nextUrl.protocol.replace(':', '') ||
    'http'
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    req.headers.get('host') ||
    req.nextUrl.host
  return `${proto}://${host}`
}

function formRedirect(req: NextRequest, params: Record<string, string>) {
  const url = new URL('/faucet', requestOrigin(req))
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url, 303)
}

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  const ct = req.headers.get('content-type') ?? ''
  const isForm =
    ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')
  let action = 'heartbeat'
  let account = PL_WATCHER_ACCOUNT
  try {
    if (isForm) {
      const form = await req.formData()
      action = String(form.get('action') ?? 'start').toLowerCase()
      account = accountOf(form.get('account'))
    } else {
      const body = await req.json()
      action = String(body.action ?? 'heartbeat').toLowerCase()
      account = accountOf(body.account)
    }
  } catch {
    if (isForm) return formRedirect(req, { watcher: 'error', msg: 'Invalid form' })
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (action === 'work' || action === 'real-test' || action === 'realtest') {
    const msg =
      'Server-side rail work was removed (the BTC rail only takes real Bitcoin headers). ' + WALLET_SIGNED
    if (isForm) return formRedirect(req, { watcher: 'error', msg: msg.slice(0, 180) })
    return NextResponse.json({ error: msg, action, walletSigned: true }, { status: 410 })
  }
  const needsCtl = action === 'start' || action === 'heartbeat' || action === 'claim'
  if (needsCtl && !ctlAvailable()) {
    if (isForm) return formRedirect(req, { watcher: 'error', msg: WALLET_SIGNED.slice(0, 180) })
    return NextResponse.json({ error: WALLET_SIGNED, action, walletSigned: true }, { status: 501 })
  }
  if (needsCtl && account !== PL_WATCHER_ACCOUNT) {
    const msg = `Server-side signing is limited to ${PL_WATCHER_ACCOUNT}. ${WALLET_SIGNED}`
    if (isForm) return formRedirect(req, { watcher: 'error', msg: msg.slice(0, 180) })
    return NextResponse.json({ error: msg, action, walletSigned: true }, { status: 403 })
  }

  try {
    if (action === 'start') {
      const snap = await startWatcher(account)
      if (isForm) {
        return formRedirect(req, {
          watcher: 'started',
          present: snap.present ? '1' : '0',
          slots: String(snap.slots),
          work: String(snap.work),
        })
      }
      return NextResponse.json({ ok: true, action, ...snap })
    }
    if (action === 'stop') {
      const snap = await stopWatcher(account)
      if (isForm) return formRedirect(req, { watcher: 'stopped', slots: String(snap.slots) })
      return NextResponse.json({ ok: true, action, ...snap })
    }
    if (action === 'heartbeat') {
      const r = await beatWatcher(account)
      return NextResponse.json({ ok: true, action, txId: r.txId, msg: r.msg, ...r.snapshot })
    }
    if (action === 'claim') {
      const snap = await claimWatcher(account)
      if (isForm) {
        return formRedirect(req, {
          watcher: 'claimed',
          claimable: String(snap.claimable),
          balance: String(snap.balance),
        })
      }
      return NextResponse.json({ ok: true, action, ...snap })
    }
    if (isForm) return formRedirect(req, { watcher: 'error', msg: 'Unknown action' })
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    if (isForm) return formRedirect(req, { watcher: 'error', msg: msg.slice(0, 180) })
    return NextResponse.json({ error: msg, account, action }, { status: 503 })
  }
}
