/**
 * Browser localStorage for linked validator node (dashboard host + port).
 *
 * Important: RPC ports (6005/5005) must never be used as the dashboard port.
 * Users often paste the public RPC URL by mistake.
 */

const STORAGE_KEY = 'qxrp-validator-node'
const DEFAULT_DASHBOARD_PORT = 8080

/** Ports that are xrpld RPC/admin — not the Python dashboard. */
const RPC_PORTS = new Set([5005, 6005, 51235])

export interface SavedValidatorNode {
  /** Hostname or IP only (no scheme, no port). */
  host: string
  /** Public dashboard port (compose publish). Default 8080. */
  port: number
  nodeName: string
  savedAt: number
}

/**
 * Parse user input into dashboard host + port.
 * Accepts: IP, domain, host:port, http(s)://host:port/...
 * Strips mistaken RPC ports (6005/5005) → uses 8080 for dashboard.
 */
export function parseHostPort(raw: string): { host: string; port: number } {
  let s = raw.trim()
  s = s.replace(/^https?:\/\//i, '')
  s = s.replace(/\/.*$/, '')

  let host = s
  let port = DEFAULT_DASHBOARD_PORT

  // host:port (IPv4 / hostname — not full IPv6)
  const m = s.match(/^(.+):(\d{2,5})$/)
  if (m) {
    const p = parseInt(m[2], 10)
    if (p >= 1 && p <= 65535) {
      host = m[1]
      port = p
    }
  }

  host = host.toLowerCase().trim()

  // User pasted RPC URL (…:6005) — dashboard is not on 6005
  if (RPC_PORTS.has(port)) {
    port = DEFAULT_DASHBOARD_PORT
  }

  return { host, port }
}

export function normalizeHost(raw: string): string {
  return parseHostPort(raw).host
}

export function loadValidatorNode(): SavedValidatorNode | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedValidatorNode> & { host?: string }
    if (!parsed?.host) return null

    // Re-parse host field (may still contain :6005 from older saves)
    const fromHost = parseHostPort(
      typeof parsed.port === 'number' && parsed.port > 0 && !String(parsed.host).includes(':')
        ? `${parsed.host}:${parsed.port}`
        : parsed.host,
    )

    let port = fromHost.port
    if (RPC_PORTS.has(port)) port = DEFAULT_DASHBOARD_PORT

    return {
      host: fromHost.host,
      port,
      nodeName: parsed.nodeName?.trim() || 'my-falcon-node',
      savedAt: parsed.savedAt ?? Date.now(),
    }
  } catch {
    return null
  }
}

export function saveValidatorNode(
  hostOrUrl: string,
  nodeName: string,
  portOverride?: number,
): SavedValidatorNode {
  const parsed = parseHostPort(hostOrUrl)
  let port =
    typeof portOverride === 'number' && portOverride > 0
      ? portOverride
      : parsed.port
  if (RPC_PORTS.has(port)) port = DEFAULT_DASHBOARD_PORT

  const entry: SavedValidatorNode = {
    host: parsed.host,
    port,
    nodeName: nodeName.trim() || 'my-falcon-node',
    savedAt: Date.now(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  return entry
}

export function clearValidatorNode(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/** Always returns a valid single-port URL (never host:6005:8080). */
export function dashboardUrl(host: string, port?: number): string {
  // If host already embeds a port, parseHostPort cleans it
  const combined =
    port && port > 0 && !/:\d{2,5}$/.test(host.trim())
      ? `${host.trim()}:${port}`
      : host
  const p = parseHostPort(combined)
  return `http://${p.host}:${p.port}`
}

export function dashboardStatsPath(host: string, port?: number): string {
  return `${dashboardUrl(host, port)}/api/stats`
}

export { DEFAULT_DASHBOARD_PORT, RPC_PORTS }
