/**
 * Falcon PL (network 2200) wire client.
 *
 * Nodes speak newline-JSON `WireMsg` on TCP (default 127.0.0.1:19101), not
 * XRPL JSON-RPC. The faucet API uses this to submit WatcherHeartbeat and
 * poll enter/exit. Gossip on the same socket is skipped, matching ctl.
 */

import net from 'net'
import { createHash, createHmac } from 'crypto'

export const PL_NETWORK_ID = Number(process.env.FALCON_PL_NETWORK_ID ?? '2200')
export const PL_DEFAULT_ADDR = process.env.FALCON_PL_RPC ?? '127.0.0.1:19101'
export const PL_WATCHER_ACCOUNT =
  process.env.FALCON_PL_WATCHER_ACCOUNT?.trim() || 'watcher-browser'
export const PL_FAUCET_ACCOUNT = process.env.FALCON_PL_FAUCET_ACCOUNT?.trim() || 'faucet'

const GOSSIP = new Set([
  'hello',
  'propose_ledger',
  'propose_header',
  'need_ledger_body',
  'ledger_body',
  'pong',
  'ledger_ok',
  'skip_packer',
  'view_change',
  'online_set_vote',
  'need_ledgers',
  'need_txs',
  'txs_batch',
  'ledgers_batch',
  'submit_tx',
])

export type PlWire = {
  type?: string
  msg?: string
  body?: Record<string, unknown>
  [k: string]: unknown
}

function parseAddr(addr: string): { host: string; port: number } {
  const trimmed = addr.replace(/^tcp:\/\//, '')
  const idx = trimmed.lastIndexOf(':')
  if (idx <= 0) throw new Error(`bad FALCON_PL_RPC: ${addr}`)
  return { host: trimmed.slice(0, idx), port: Number(trimmed.slice(idx + 1)) }
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function hmacPublicKey(account: string): string {
  return `pl-pub:${sha256Hex(account).slice(0, 16)}`
}

export function hmacSign(account: string, message: string): string {
  return createHmac('sha256', `pl-secret:${account}`).update(message).digest('hex')
}

export type PlTxBody = { kind: string; [k: string]: unknown }

export type PlTx = {
  account: string
  sequence: number
  destination: string
  amount: number
  fee: number
  network_id: number
  public_key: string
  signature: string
  tx_id: string
  body: PlTxBody
}

export function signPlTx(opts: {
  account: string
  sequence: number
  destination?: string
  amount?: number
  fee: number
  networkId?: number
  body: PlTxBody
}): PlTx {
  const destination = opts.destination ?? ''
  const amount = opts.amount ?? 0
  const networkId = opts.networkId ?? PL_NETWORK_ID
  const bodyS = JSON.stringify(opts.body)
  const payload = `pl-tx:v2|${opts.account}|${opts.sequence}|${destination}|${amount}|${opts.fee}|${networkId}|${bodyS}`
  return {
    account: opts.account,
    sequence: opts.sequence,
    destination,
    amount,
    fee: opts.fee,
    network_id: networkId,
    public_key: hmacPublicKey(opts.account),
    signature: hmacSign(opts.account, payload),
    tx_id: sha256Hex(payload),
    body: opts.body,
  }
}

export function plRpc(
  msg: Record<string, unknown>,
  opts?: { addr?: string; timeoutMs?: number },
): Promise<PlWire> {
  const addr = opts?.addr ?? PL_DEFAULT_ADDR
  const timeoutMs = opts?.timeoutMs ?? 8_000
  const { host, port } = parseAddr(addr)

  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port })
    let buf = ''
    let settled = false
    const timer = setTimeout(() => finish(new Error(`pl rpc timeout ${addr}`)), timeoutMs)

    const finish = (err?: Error, value?: PlWire) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      sock.removeAllListeners()
      sock.destroy()
      if (err) reject(err)
      else resolve(value as PlWire)
    }

    sock.setEncoding('utf8')
    sock.on('error', (e) => finish(e))
    sock.on('connect', () => {
      sock.write(JSON.stringify(msg) + '\n')
    })
    sock.on('data', (chunk: string) => {
      buf += chunk
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let parsed: PlWire
        try {
          parsed = JSON.parse(line) as PlWire
        } catch {
          continue
        }
        const t = String(parsed.type ?? '')
        if (GOSSIP.has(t)) continue
        finish(undefined, parsed)
        return
      }
    })
    sock.on('end', () => finish(new Error('pl rpc closed')))
  })
}

export async function plStatus(includeAccounts = false): Promise<Record<string, unknown>> {
  const r = await plRpc({ type: 'status_req', include_accounts: includeAccounts })
  if (r.type === 'err') throw new Error(String(r.msg ?? 'status error'))
  return (r.body ?? {}) as Record<string, unknown>
}

export async function plAccount(account: string): Promise<Record<string, unknown>> {
  const r = await plRpc({ type: 'account_query', account })
  if (r.type === 'err') throw new Error(String(r.msg ?? 'account error'))
  return (r.body ?? {}) as Record<string, unknown>
}

export async function plSubmit(tx: PlTx): Promise<{ ok: boolean; msg: string }> {
  const r = await plRpc({ type: 'submit_tx', tx })
  if (r.type === 'err') return { ok: false, msg: String(r.msg ?? 'rejected') }
  return { ok: true, msg: String(r.msg ?? 'accepted') }
}
