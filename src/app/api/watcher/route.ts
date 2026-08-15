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

export async function POST(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 })
  }

  let action = 'heartbeat'
  let account = PL_WATCHER_ACCOUNT
  try {
    const body = await req.json()
    action = String(body.action ?? 'heartbeat').toLowerCase()
    account = accountOf(body.account)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    if (action === 'start') {
      const snap = await startWatcher(account)
      return NextResponse.json({ ok: true, action, ...snap })
    }
    if (action === 'stop') {
      const snap = await stopWatcher(account)
      return NextResponse.json({ ok: true, action, ...snap })
    }
    if (action === 'heartbeat') {
      const r = await beatWatcher(account)
      return NextResponse.json({ ok: true, action, txId: r.txId, msg: r.msg, ...r.snapshot })
    }
    if (action === 'work') {
      const snap = await workWatcher(account)
      return NextResponse.json({ ok: true, action, ...snap })
    }
    if (action === 'claim') {
      const snap = await claimWatcher(account)
      return NextResponse.json({ ok: true, action, ...snap })
    }
    if (action === 'real-test' || action === 'realtest') {
      const snap = await realWatcherTest(account)
      return NextResponse.json({ ok: true, action: 'real-test', ...snap })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    return NextResponse.json({ error: msg, account, action }, { status: 503 })
  }
}
