// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// Cursor pagination. Cursors are opaque base64url offsets so a gateway can pass them through.

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100

export type Page<T> = { items: T[]; page: { limit: number; next_cursor: string | null; total: number } }

export function encodeCursor(offset: number): string {
  return Buffer.from(`o:${offset}`, 'utf8').toString('base64url')
}

export function decodeCursor(c: string | null | undefined): number | null {
  if (!c) return 0
  try {
    const m = /^o:(\d{1,9})$/.exec(Buffer.from(c, 'base64url').toString('utf8'))
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

export function parseLimit(v: string | null | undefined, max = MAX_LIMIT): number | null {
  if (v == null || v === '') return DEFAULT_LIMIT
  if (!/^\d+$/.test(v)) return null
  const n = Number(v)
  if (n < 1) return null
  return Math.min(n, max)
}

export type PageParams = { limit: number; offset: number }

/** Parse ?limit and ?cursor. Returns a string error for a 400. */
export function pageParams(sp: URLSearchParams, max = MAX_LIMIT): PageParams | string {
  const limit = parseLimit(sp.get('limit'), max)
  if (limit == null) return 'limit must be a positive integer'
  const offset = decodeCursor(sp.get('cursor'))
  if (offset == null) return 'invalid cursor'
  return { limit, offset }
}

export function paginate<T>(all: readonly T[], p: PageParams): Page<T> {
  const items = all.slice(p.offset, p.offset + p.limit)
  const next = p.offset + items.length
  return { items, page: { limit: p.limit, next_cursor: next < all.length ? encodeCursor(next) : null, total: all.length } }
}
