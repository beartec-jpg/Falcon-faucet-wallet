// Copyright (c) BEARTEC. All Rights Reserved.
// Process-local FillHistoryStore singleton + optional dump path for restart retention.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { FillHistoryStore, type FillRecord } from './fill-history'

const globalKey = '__falcon_fill_history_store__'
type G = typeof globalThis & { [globalKey]?: FillHistoryStore }

function dumpPath(): string | null {
  const p = process.env.FPL_FILL_HISTORY_DUMP_PATH?.trim()
  return p || null
}

function loadIfPresent(store: FillHistoryStore): void {
  const path = dumpPath()
  if (!path || !existsSync(path)) return
  try {
    const rows = JSON.parse(readFileSync(path, 'utf8')) as FillRecord[]
    if (Array.isArray(rows)) store.load(rows)
  } catch (e) {
    console.error('[fill-history] load failed', e instanceof Error ? e.message : String(e))
  }
}

export function getFillHistoryStore(): FillHistoryStore {
  const g = globalThis as G
  if (!g[globalKey]) {
    const store = new FillHistoryStore()
    loadIfPresent(store)
    g[globalKey] = store
  }
  return g[globalKey]!
}

export function persistFillHistoryStore(): void {
  const path = dumpPath()
  if (!path) return
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(getFillHistoryStore().dump()))
  } catch (e) {
    console.error('[fill-history] dump failed', e instanceof Error ? e.message : String(e))
  }
}
