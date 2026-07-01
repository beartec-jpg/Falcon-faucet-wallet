// xrpld JSON-RPC client — pure fetch, no WebSocket needed
// Resilient version with multiple public nodes + timeouts.

const ENV_RPC = process.env.XRPLD_RPC_URL

// Public nodes (port 6005 only — MUST use https:// in production to protect signed transactions).
// For the new clean testnet, configure via XRPLD_RPC_URL (recommended) or update this list.
export const PUBLIC_RPC_NODES: string[] = [
  // Examples only — replace with your deployed nodes using TLS
  // 'https://your-node.example.com:6005',
]

const RPC_NODES = ENV_RPC ? [ENV_RPC, ...PUBLIC_RPC_NODES] : PUBLIC_RPC_NODES

// Convenient default for files that still do their own RPC calls.
// WARNING: Must be https:// in production. Plain HTTP exposes signed tx_blobs to MITM.
export const DEFAULT_RPC_URL = ENV_RPC || (PUBLIC_RPC_NODES[0] ?? 'https://YOUR_NODE:6005')

const RPC_TIMEOUT_MS = 4500 // short timeout so Vercel doesn't hang forever

export interface ServerInfo {
  server_state: string
  validated_ledger?: { seq: number; close_time: number; reserve_base_xrp: number }
  peers: number
  uptime: number
  load_factor: number
  complete_ledgers: string
}

export interface AccountInfo {
  account_data: { Account: string; Balance: string; Sequence: number }
}

interface RpcResponse<T> {
  result: T & { status?: string; error?: string; error_message?: string }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      // Vercel serverless: don't cache RPC calls
      cache: 'no-store',
    })
    clearTimeout(timeout)
    return res
  } catch (err) {
    clearTimeout(timeout)
    throw err
  }
}

async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  let lastError: Error | null = null

  for (const nodeUrl of RPC_NODES) {
    try {
      const res = await fetchWithTimeout(
        nodeUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, params: [params] }),
        },
        RPC_TIMEOUT_MS
      )

      if (!res.ok) {
        lastError = new Error(`RPC HTTP ${res.status} from ${nodeUrl}`)
        continue
      }

      const body = (await res.json()) as RpcResponse<T>

      if (body.result?.error) {
        // Node responded but returned a protocol error (e.g. actNotFound)
        throw new Error(body.result.error_message ?? body.result.error)
      }

      return body.result as T
    } catch (err: any) {
      lastError = err
      // try next node
    }
  }

  throw lastError ?? new Error('All Falcon Ledger public RPC nodes are unreachable')
}

export async function getServerInfo(): Promise<ServerInfo> {
  const result = await call<{ info: ServerInfo }>('server_info')
  return result.info
}

export async function getAccountInfo(account: string): Promise<AccountInfo> {
  return call<AccountInfo>('account_info', {
    account,
    ledger_index: 'current',
  })
}

export async function getLedgerIndex(): Promise<number> {
  const info = await getServerInfo()
  return info.validated_ledger?.seq ?? 0
}

export async function submitTx(tx_blob: string): Promise<{ tx_json: { hash: string }; engine_result: string; engine_result_message: string }> {
  return call('submit', { tx_blob })
}

export async function getTx(hash: string): Promise<{
  validated?: boolean
  meta?: { TransactionResult?: string }
}> {
  return call('tx', { transaction: hash })
}
