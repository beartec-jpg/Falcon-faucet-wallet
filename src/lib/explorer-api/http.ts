// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// Falcon PL explorer API v1: JSON responses with ETag, CDN cache headers and CORS.
// Gateway-friendly: every response carries x-api-version and a stable error envelope.

import { createHash } from 'crypto'

export const API_VERSION = '1.0.0'

export type CachePolicy = { sMaxAge: number; swr: number; browser?: number } | 'no-store'

/** Default policies. Short TTLs: the tip moves every ~200 ms but the CDN absorbs read load. */
export const CACHE = {
  live: { sMaxAge: 2, swr: 8, browser: 0 },
  short: { sMaxAge: 5, swr: 25, browser: 0 },
  medium: { sMaxAge: 30, swr: 120, browser: 10 },
  static: { sMaxAge: 3600, swr: 86400, browser: 300 },
} as const satisfies Record<string, CachePolicy>

export function etagOf(body: string): string {
  return `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 27)}"`
}

function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false
  if (header.trim() === '*') return true
  const norm = (t: string) => t.trim().replace(/^W\//, '')
  return header.split(',').some((t) => norm(t) === norm(etag))
}

export function cacheHeaders(policy: CachePolicy): Record<string, string> {
  if (policy === 'no-store') return { 'cache-control': 'no-store' }
  const edge = `public, s-maxage=${policy.sMaxAge}, stale-while-revalidate=${policy.swr}`
  return {
    'cache-control': `public, max-age=${policy.browser ?? 0}, s-maxage=${policy.sMaxAge}, stale-while-revalidate=${policy.swr}`,
    'cdn-cache-control': edge,
    'vercel-cdn-cache-control': edge,
  }
}

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'If-None-Match, Content-Type',
  'access-control-expose-headers': 'ETag, X-Api-Version, X-Next-Cursor',
  'access-control-max-age': '86400',
}

function baseHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    'x-api-version': API_VERSION,
    vary: 'Accept-Encoding, If-None-Match',
    ...CORS_HEADERS,
  }
}

/** JSON with a weak ETag; 304 when the request's If-None-Match matches. */
export function apiJson(
  req: Request | null,
  data: unknown,
  opts: { status?: number; cache?: CachePolicy; headers?: Record<string, string> } = {},
): Response {
  const body = JSON.stringify(data)
  const status = opts.status ?? 200
  const policy = status >= 400 ? 'no-store' : (opts.cache ?? CACHE.short)
  const headers: Record<string, string> = { ...baseHeaders(), ...cacheHeaders(policy), ...(opts.headers ?? {}) }
  if (status === 200) {
    const etag = etagOf(body)
    headers.etag = etag
    if (req && ifNoneMatchHits(req.headers.get('if-none-match'), etag)) {
      delete headers['content-type']
      return new Response(null, { status: 304, headers })
    }
  }
  return new Response(req?.method === 'HEAD' ? null : body, { status, headers })
}

export type ApiErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'not_implemented'
  | 'node_unavailable'
  | 'internal'

export function apiError(req: Request | null, status: number, code: ApiErrorCode, message: string): Response {
  return apiJson(req, { error: { code, message } }, { status })
}

export function apiOptions(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, 'x-api-version': API_VERSION } })
}

/** Errors from the node are logged server-side but only a generic message goes to clients. */
export function nodeUnavailable(req: Request | null, where: string, e: unknown): Response {
  console.error(`[v1/${where}]`, e instanceof Error ? e.message : String(e))
  return apiError(req, 503, 'node_unavailable', 'Falcon PL node unavailable')
}
