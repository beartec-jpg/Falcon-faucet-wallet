/**
 * Browser localStorage for linked validator node (dashboard IP).
 */

const STORAGE_KEY = 'qxrp-validator-node'

export interface SavedValidatorNode {
  host: string       // IP or hostname, no scheme/port
  nodeName: string
  savedAt: number
}

function normalizeHost(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:8080$/, '')
    .toLowerCase()
}

export function loadValidatorNode(): SavedValidatorNode | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedValidatorNode
    if (!parsed?.host) return null
    return { ...parsed, host: normalizeHost(parsed.host) }
  } catch {
    return null
  }
}

export function saveValidatorNode(host: string, nodeName: string): SavedValidatorNode {
  const entry: SavedValidatorNode = {
    host: normalizeHost(host),
    nodeName: nodeName.trim() || 'my-falcon-node',
    savedAt: Date.now(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  return entry
}

export function clearValidatorNode(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function dashboardUrl(host: string): string {
  return `http://${normalizeHost(host)}:8080`
}