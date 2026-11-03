// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// Node access for API v1. Reuses the site's PL wire client (pl-rpc / statusExact), with a short
// in-process single-flight cache so a burst of cache misses costs one status_req.

import { parseExact } from '@/lib/pl-exact-json'
import { plRpc, type PlWire } from '@/lib/pl-rpc'
import { statusExact } from '@/lib/rails-pools-server'
import { BlockRing, tipBlockFromStatus } from './mappers'

type Obj = Record<string, unknown>

const STATUS_TTL_MS = 1_000
let statusCache: { at: number; body: Obj } | null = null
let inflight: Promise<Obj> | null = null

export const blockRing = new BlockRing(256)
export const startedAt = Date.now()
/** When this instance last saw the tip height advance (for health). */
export const tipSeen: { height: number; at: number | null } = { height: 0, at: null }
export const nodeCalls = { ok: 0, failed: 0, lastOkAt: null as number | null, lastError: null as string | null }

export type StatusFetcher = () => Promise<Obj>
let fetcher: StatusFetcher = statusExact
/** Test hook. */
export function setStatusFetcher(f: StatusFetcher | null): void {
  fetcher = f ?? statusExact
  statusCache = null
  inflight = null
}

export async function getStatus(now = Date.now()): Promise<{ body: Obj; fetchedAt: number }> {
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) return { body: statusCache.body, fetchedAt: statusCache.at }
  if (!inflight) {
    inflight = fetcher()
      .then((body) => {
        const at = Date.now()
        statusCache = { at, body }
        nodeCalls.ok++
        nodeCalls.lastOkAt = at
        const b = tipBlockFromStatus(body, at)
        blockRing.remember(b)
        if (b.height > tipSeen.height) {
          tipSeen.height = b.height
          tipSeen.at = at
        }
        return body
      })
      .catch((e) => {
        nodeCalls.failed++
        nodeCalls.lastError = e instanceof Error ? e.message : String(e)
        throw e
      })
      .finally(() => {
        inflight = null
      })
  }
  const body = await inflight
  return { body, fetchedAt: statusCache?.at ?? Date.now() }
}

function exactBody(r: PlWire): Obj {
  const raw = typeof r.raw === 'string' ? r.raw : JSON.stringify(r)
  try {
    return ((parseExact(raw) as Obj).body ?? {}) as Obj
  } catch {
    return (r.body ?? {}) as Obj
  }
}

export type WireCall = (msg: Obj, opts?: { timeoutMs?: number }) => Promise<PlWire>
let wire: WireCall = plRpc
/** Test hook. */
export function setWire(w: WireCall | null): void {
  wire = w ?? plRpc
}

export async function getAccount(account: string): Promise<Obj> {
  const r = await wire({ type: 'account_query', account }, { timeoutMs: 8_000 })
  if (r.type === 'err') throw new Error(String(r.msg ?? 'account error'))
  return exactBody(r)
}

/** Result of an order-book RPC: data, not active yet, or not supported by this node/gateway. */
export type BookResult = { kind: 'ok'; body: Obj } | { kind: 'inactive'; reason: string } | { kind: 'unsupported'; reason: string }

export function classifyBookReply(r: PlWire): BookResult {
  if (r.type === 'order_book') return { kind: 'ok', body: exactBody(r) }
  const msg = String(r.msg ?? r.type ?? '')
  if (/not active/i.test(msg)) return { kind: 'inactive', reason: msg }
  return { kind: 'unsupported', reason: msg || 'unexpected reply' }
}

export async function bookCall(msg: Obj): Promise<BookResult> {
  try {
    return classifyBookReply(await wire(msg, { timeoutMs: 8_000 }))
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    // The HTTPS wire gateway filters unknown message types (403) — treat as unsupported, not down.
    if (/gateway 40[034]|unknown variant|filtered/i.test(m)) return { kind: 'unsupported', reason: 'order book RPC not exposed by node gateway' }
    throw e
  }
}
