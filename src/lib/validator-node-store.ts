/**
 * Browser localStorage for linked validator node (dashboard host + port).
 */

const STORAGE_KEY = 'qxrp-validator-node'
const DEFAULT_DASHBOARD_PORT = 8080

export interface SavedValidatorNode {
  /** Hostname or IP only (no scheme). */
  host: string
  /** Public dashboard port (compose publish / reverse-proxy listen). Default 8080. */
  port: number
  nodeName: string
  savedAt: number
}

export function parseHostPort(raw: string): { host: string; port: number } {
  let s = raw.trim()
  s = s.replace(/^https?:\/\//i, '')
  s = s.replace(/\/.*$/, '')

  // host:port (IPv4 / hostname only — not full IPv6)
  const m = s.match(/^(.+):(\d{2,5})$/)
  if (m) {
    const port = parseInt(m[2], 10)
    if (port >= 1 && port <= 65535) {
      return { host: m[1].toLowerCase(), port }
    }
  }
  return { host: s.toLowerCase(), port: DEFAULT_DASHBOARD_PORT }
}

function normalizeHost(raw: string): string {
  return parseHostPort(raw).host
}

export function loadValidatorNode(): SavedValidatorNode | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedValidatorNode> & { host?: string }
    if (!parsed?.host) return null
    const { host, port: fromString } = parseHostPort(parsed.host)
    const port =
      typeof parsed.port === 'number' && parsed.port > 0
        ? parsed.port
        : fromString
    return {
      host,
      port: port || DEFAULT_DASHBOARD_PORT,
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
  const entry: SavedValidatorNode = {
    host: parsed.host,
    port:
      typeof portOverride === 'number' && portOverride > 0
        ? portOverride
        : parsed.port,
    nodeName: nodeName.trim() || 'my-falcon-node',
    savedAt: Date.now(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  return entry
}

export function clearValidatorNode(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function dashboardUrl(host: string, port?: number): string {
  const p = parseHostPort(host)
  const usePort = port && port > 0 ? port : p.port
  return `http://${p.host}:${usePort}`
}

export function dashboardStatsPath(host: string, port?: number): string {
  return `${dashboardUrl(host, port)}/api/stats`
}

export { DEFAULT_DASHBOARD_PORT, normalizeHost }
