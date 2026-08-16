// /api/watcher
// GET  ?account=   live enter/exit + on-chain presence
// POST { action: 'start' | 'stop' | 'heartbeat', account? }

import { NextRequest, NextResponse } from 'next/server'
import { isOriginAllowed } from '@/lib/origin'
import { PL_WATCHER_ACCOUNT } from '@/lib/pl-rpc'
import {
  beatWatcher,
  claimWatcher,
  realWatcherTest,
  startWatcher,
  stopWatcher,
  watcherSnapshot,
  workWatcher,
} from '@/lib/pl-watcher'

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
    if (action === 'work') {
      const snap = await workWatcher(account)
      if (isForm) {
        return formRedirect(req, {
          watcher: 'worked',
          work: String(snap.work),
          slots: String(snap.slots),
        })
      }
      return NextResponse.json({ ok: true, action, ...snap })
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
    if (action === 'real-test' || action === 'realtest') {
      const snap = await realWatcherTest(account)
      const pay = snap.lastPay
      if (isForm) {
        return formRedirect(req, {
          watcher: 'paid',
          work: String(pay?.work ?? snap.work),
          slots: String(pay?.slots ?? snap.slots),
          weight: String(pay?.weight ?? snap.weight),
          claimable: String(pay?.paid ?? snap.claimable),
          balance: String(pay?.balance ?? snap.balance),
          rail: String(pay?.railTip ?? snap.railTip),
          epoch: String(pay?.epoch ?? snap.epoch),
        })
      }
      return NextResponse.json({ ok: true, action: 'real-test', ...snap })
    }
    if (isForm) return formRedirect(req, { watcher: 'error', msg: 'Unknown action' })
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    if (isForm) return formRedirect(req, { watcher: 'error', msg: msg.slice(0, 180) })
    return NextResponse.json({ error: msg, account, action }, { status: 503 })
  }
}
