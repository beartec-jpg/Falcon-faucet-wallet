import { NextRequest, NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,253}[a-z0-9])?$/i
const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/

// Optional allow-list of validator hosts/IPs (comma-separated). When set, only
// these hosts may be proxied — the strongest defence against SSRF.
const ALLOWED_DASHBOARD_HOSTS = (process.env.ALLOWED_DASHBOARD_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)

function isValidHost(host: string): boolean {
  if (!host || host.length > 255) return false
  if (IP_RE.test(host)) {
    return host.split('.').every((o) => {
      const n = parseInt(o, 10)
      return n >= 0 && n <= 255
    })
  }
  return HOST_RE.test(host)
}

/**
 * Expand an IPv6 address to its full 8-group form (lowercase, 4 hex digits per
 * group) so prefix checks work regardless of the source representation
 * (e.g. "::1" vs "0:0:0:0:0:0:0:1").
 */
function expandIpv6(ip: string): string | null {
  let s = ip.toLowerCase()
  // Strip zone id if present (fe80::1%eth0)
  const pct = s.indexOf('%')
  if (pct !== -1) s = s.slice(0, pct)

  // Handle an embedded IPv4 tail (e.g. ::ffff:192.0.2.1) by converting it to hex.
  const v4 = s.match(/(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (v4) {
    const octets = v4[2].split('.').map((o) => parseInt(o, 10))
    if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    s = `${v4[1]}${hi}:${lo}`
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - (head.length + tail.length)
  if (halves.length === 1 && head.length !== 8) return null
  if (halves.length === 2 && missing < 0) return null
  const groups = [
    ...head,
    ...Array(halves.length === 2 ? missing : 0).fill('0'),
    ...tail,
  ]
  if (groups.length !== 8) return null
  return groups.map((g) => g.padStart(4, '0')).join(':')
}

/**
 * Reject IP addresses that point at internal / non-routable ranges. This blocks
 * SSRF attempts against loopback, private (RFC1918), link-local (incl. cloud
 * metadata 169.254.169.254), CGNAT, and IPv6 internal ranges.
 */
function isBlockedIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const p = ip.split('.').map((o) => parseInt(o, 10))
    if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
    const [a, b] = p
    if (a === 0) return true                          // "this" network
    if (a === 10) return true                         // private
    if (a === 127) return true                        // loopback
    if (a === 169 && b === 254) return true           // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true  // private
    if (a === 192 && b === 168) return true           // private
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT (RFC6598)
    if (a >= 224) return true                         // multicast / reserved
    return false
  }
  if (v === 6) {
    const full = expandIpv6(ip)
    if (!full) return true // cannot normalise → treat as unsafe
    const groups = full.split(':')

    // IPv4-mapped (::ffff:a.b.c.d → 0000:...:ffff:HHHH:LLLL) — re-check the v4.
    if (groups.slice(0, 5).every((g) => g === '0000') && groups[5] === 'ffff') {
      const hi = parseInt(groups[6], 16)
      const lo = parseInt(groups[7], 16)
      const v4 = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
      return isBlockedIp(v4)
    }

    if (full === '0000:0000:0000:0000:0000:0000:0000:0001') return true // loopback
    if (full === '0000:0000:0000:0000:0000:0000:0000:0000') return true // unspecified
    const first = groups[0]
    // fe80::/10 link-local
    if (first.startsWith('fe8') || first.startsWith('fe9') || first.startsWith('fea') || first.startsWith('feb')) return true
    // fc00::/7 unique-local
    if (first.startsWith('fc') || first.startsWith('fd')) return true
    // ff00::/8 multicast
    if (first.startsWith('ff')) return true
    return false
  }
  // Not a literal IP — caller must resolve first.
  return true
}

async function resolvesToPublicAddress(host: string): Promise<boolean> {
  // Literal IP: validate directly.
  if (isIP(host)) return !isBlockedIp(host)

  // Hostname: resolve ALL addresses and require every one to be public,
  // preventing DNS-rebinding to an internal address.
  try {
    const results = await lookup(host, { all: true })
    if (results.length === 0) return false
    return results.every((r) => !isBlockedIp(r.address))
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('host')?.trim() ?? ''
  const host = raw
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:8080$/i, '')
    .toLowerCase()

  if (!isValidHost(host)) {
    return NextResponse.json({ error: 'Invalid host' }, { status: 400 })
  }

  // Production: require explicit allow-list (SSRF defence)
  if (
    (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') &&
    ALLOWED_DASHBOARD_HOSTS.length === 0
  ) {
    return NextResponse.json(
      {
        error:
          'Dashboard proxy disabled: set ALLOWED_DASHBOARD_HOSTS to an explicit allow-list.',
      },
      { status: 503 },
    )
  }

  if (
    ALLOWED_DASHBOARD_HOSTS.length > 0 &&
    !ALLOWED_DASHBOARD_HOSTS.includes(host)
  ) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 })
  }

  // SSRF guard: never allow proxying to internal / non-routable addresses.
  if (!(await resolvesToPublicAddress(host))) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 })
  }

  const url = `http://${host}:8080/api/stats`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error', // do not follow redirects to bypass the SSRF guard
    })
    clearTimeout(timer)

    if (!res.ok) {
      return NextResponse.json(
        { error: `Dashboard unreachable (${res.status})`, host },
        { status: 502 },
      )
    }

    const data = await res.json()
    return NextResponse.json({ ...data, _proxy_host: host })
  } catch {
    return NextResponse.json(
      { error: 'Dashboard unreachable', host, hint: 'Open TCP 8080 on your server firewall' },
      { status: 502 },
    )
  }
}
