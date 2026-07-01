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
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true                 // loopback / unspecified
    if (lower.startsWith('fe80')) return true                         // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local
    if (lower.startsWith('ff')) return true                           // multicast
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-check embedded v4
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedIp(mapped[1])
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

  if (ALLOWED_DASHBOARD_HOSTS.length > 0 && !ALLOWED_DASHBOARD_HOSTS.includes(host)) {
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
