import type { NetworkKey } from '@/lib/networks'

export function withNetworkQuery(path: string, networkKey: NetworkKey): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}network=${networkKey}`
}