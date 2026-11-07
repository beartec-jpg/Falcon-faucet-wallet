// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 BEARTEC
//
// Client for the Falcon Cloud RPC gateway (falcon-pl-rs/tools/fpl-gateway):
// POST /v1/rpc, JSON-RPC 2.0, API key in a header. On HTTP 429 with
// Retry-After the client waits and retries; a quota 429 (no Retry-After) is
// thrown at once because it lasts until the 1st of the month.

import type { SignedTx } from './tx.js'

export const DEFAULT_GATEWAY_URL = 'https://rpc.falcon-fpl.com'

export interface GatewayClientOptions {
  /** `fplk_...` key. Sent as a header, never in the URL. */
  apiKey?: string
  url?: string
  /** `x-api-key` (default) or `bearer` (Authorization: Bearer). */
  authHeader?: 'x-api-key' | 'bearer'
  /** Retries after 429 (default 3). */
  maxRetries?: number
  /** Cap for a single Retry-After wait in ms (default 30000). */
  maxRetryDelayMs?: number
  fetch?: typeof fetch
  /** For tests. */
  sleep?: (ms: number) => Promise<void>
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly data?: unknown,
    readonly retryAfterSec?: number,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

export class GatewayClient {
  readonly url: string
  #key?: string
  #auth: 'x-api-key' | 'bearer'
  #maxRetries: number
  #maxDelay: number
  #fetch: typeof fetch
  #sleep: (ms: number) => Promise<void>
  #id = 0

  constructor(o: GatewayClientOptions = {}) {
    this.url = (o.url ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, '')
    this.#key = o.apiKey
    this.#auth = o.authHeader ?? 'x-api-key'
    this.#maxRetries = o.maxRetries ?? 3
    this.#maxDelay = o.maxRetryDelayMs ?? 30_000
    this.#fetch = o.fetch ?? globalThis.fetch.bind(globalThis)
    this.#sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  /** Key-free description for logs. */
  toJSON() {
    return { url: this.url, apiKey: this.#key ? '[redacted]' : undefined }
  }

  #headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json' }
    if (json) h['content-type'] = 'application/json'
    if (this.#key) {
      if (this.#auth === 'bearer') h.authorization = `Bearer ${this.#key}`
      else h['x-api-key'] = this.#key
    }
    return h
  }

  async #send(path: string, init: { method: string; body?: string }): Promise<{ status: number; body: unknown }> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.#fetch(this.url + path, {
        method: init.method,
        headers: this.#headers(init.body !== undefined),
        body: init.body,
      })
      const text = await res.text()
      let body: unknown = text
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        /* non-JSON */
      }
      if (res.status === 429) {
        const ra = res.headers.get('retry-after')
        const sec = ra !== null && /^\d+(\.\d+)?$/.test(ra.trim()) ? Number(ra) : undefined
        const err = (body as { error?: { message?: string; code?: number } })?.error
        if (sec !== undefined && attempt < this.#maxRetries) {
          await this.#sleep(Math.min(sec * 1000, this.#maxDelay))
          continue
        }
        throw new GatewayError(err?.message ?? 'rate limited', 429, err?.code ?? -32005, body, sec)
      }
      return { status: res.status, body }
    }
  }

  /** Raw JSON-RPC call. `paramsJson` lets callers pass exact JSON (u64-safe). */
  async rpc<T = unknown>(method: string, params?: Record<string, unknown>, paramsJson?: string): Promise<T> {
    const id = ++this.#id
    const p = paramsJson ?? JSON.stringify(params ?? {})
    const body = `{"jsonrpc":"2.0","id":${id},"method":${JSON.stringify(method)},"params":${p}}`
    const { status, body: out } = await this.#send('/v1/rpc', { method: 'POST', body })
    const o = out as { result?: T; error?: { code: number; message: string; data?: unknown } }
    if (o && typeof o === 'object' && o.error) throw new GatewayError(o.error.message, status, o.error.code, o.error.data)
    if (status >= 400 || !o || typeof o !== 'object' || !('result' in o)) {
      throw new GatewayError(`gateway HTTP ${status}`, status, undefined, out)
    }
    return o.result as T
  }

  status() { return this.rpc('fpl_status') }
  health(warnings?: number) { return this.rpc('fpl_health', warnings === undefined ? {} : { warnings }) }
  getAccount(account: string) { return this.rpc('fpl_getAccount', { account }) }
  orderBook(pair: string, levels?: number) { return this.rpc('fpl_orderBook', levels === undefined ? { pair } : { pair, levels }) }
  openOrders(account: string) { return this.rpc('fpl_openOrders', { account }) }
  fills(q: { pair?: string; account?: string; limit?: number } = {}) { return this.rpc('fpl_fills', q) }

  /**
   * Submit a signed tx (5 units). Sends the exact wire JSON so u64 amounts
   * are not rounded. Testnet only: FPL testnet tokens have no monetary value.
   */
  submitTx(signed: SignedTx | string) {
    const json = typeof signed === 'string' ? signed : signed.json
    return this.rpc('fpl_submitTx', undefined, `{"tx":${json}}`)
  }

  async #get(path: string) {
    const { status, body } = await this.#send(path, { method: 'GET' })
    if (status >= 400) throw new GatewayError(`gateway HTTP ${status}`, status, undefined, body)
    return body
  }
  /** GET /v1/health (no key needed). */
  gatewayHealth() { return this.#get('/v1/health') }
  tiers() { return this.#get('/v1/tiers') }
  /** Caller's month-to-date usage. */
  usage() { return this.#get('/v1/usage') }
}
