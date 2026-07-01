// Server-side client for the Falcon signing proxy on node1.

// NetworkID is only required on networks with ID > 1024 (XRPL signing rule).
const NETWORK_ID = parseInt(process.env.NEXT_PUBLIC_NETWORK_ID ?? '1001', 10)
const INCLUDE_NETWORK_ID = NETWORK_ID > 1024

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
const ALLOW_INSECURE_TRANSPORT = process.env.ALLOW_INSECURE_TRANSPORT === 'true'

let insecureWarned = false

function assertSecureTransport(url: string): void {
  if (url.startsWith('https://')) return
  if (!IS_PRODUCTION) return
  if (ALLOW_INSECURE_TRANSPORT) {
    if (!insecureWarned) {
      console.warn('[signer-proxy] Using plaintext HTTP for SIGNER_PROXY_URL in production. The bearer token and any forwarded secrets are exposed to MITM. Set ALLOW_INSECURE_TRANSPORT=false and use HTTPS/mTLS or an SSH tunnel.')
      insecureWarned = true
    }
    return
  }
  throw new Error('SIGNER_PROXY_URL must use https:// in production. Configure TLS (or set ALLOW_INSECURE_TRANSPORT=true to explicitly accept the risk on a trusted network).')
}

function proxyBase(): string {
  const url = process.env.SIGNER_PROXY_URL?.replace(/\/$/, '')
  if (!url) throw new Error('SIGNER_PROXY_URL is not configured')
  assertSecureTransport(url)
  return url
}

function proxyHeaders(): Record<string, string> {
  const token = process.env.SIGNER_PROXY_TOKEN
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export interface SignedTx {
  tx_blob: string
  hash?: string
}

export interface ProposedWallet {
  account_id: string
  public_key: string
  key_type: string
  falcon_secret: string
}

function isClassicSeed(secret: string): boolean {
  return secret.startsWith('s') && secret.length < 64
}

export async function proxySign(
  tx_json: Record<string, unknown>,
  secret: string,
): Promise<SignedTx> {
  const enriched =
    INCLUDE_NETWORK_ID && !('NetworkID' in tx_json)
      ? { ...tx_json, NetworkID: NETWORK_ID }
      : tx_json

  const body: Record<string, unknown> = isClassicSeed(secret)
    ? { tx_json: enriched, secret }
    : { tx_json: enriched, falcon_secret: secret }

  const res = await fetch(`${proxyBase()}/sign`, {
    method: 'POST',
    headers: proxyHeaders(),
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Signing proxy error ${res.status}: ${text}`)
  }

  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return { tx_blob: data.tx_blob, hash: data.hash }
}

export async function proxyWalletPropose(
  key_type = 'falcon512',
): Promise<ProposedWallet> {
  const res = await fetch(`${proxyBase()}/wallet_propose`, {
    method: 'POST',
    headers: proxyHeaders(),
    body: JSON.stringify({ key_type }),
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Wallet propose error ${res.status}: ${text}`)
  }

  const data = await res.json()
  if (data.error) throw new Error(data.error)
  if (!data.falcon_secret || !data.account_id) {
    throw new Error('Invalid wallet_propose response')
  }
  return data as ProposedWallet
}