import { NextRequest, NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,253}[a-z0-9])?$/i
const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/
const DEFAULT_PORT = 8080

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

function expandIpv6(ip: string): string | null {
  let s = ip.toLowerCase()
  const pct = s.indexOf('%')
  if (pct !== -1) s = s.slice(0, pct)

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

function isBlockedIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const p = ip.split('.').map((o) => parseInt(o, 10))
    if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true
    const [a, b] = p
    if (a === 0) return true
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }
  if (v === 6) {
    const full = expandIpv6(ip)
    if (!full) return true
    const groups = full.split(':')

    if (groups.slice(0, 5).every((g) => g === '0000') && groups[5] === 'ffff') {
      const hi = parseInt(groups[6], 16)
      const lo = parseInt(groups[7], 16)
      const v4 = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
      return isBlockedIp(v4)
    }

    if (full === '0000:0000:0000:0000:0000:0000:0000:0001') return true
    if (full === '0000:0000:0000:0000:0000:0000:0000:0000') return true
    const first = groups[0]
    if (first.startsWith('fe8') || first.startsWith('fe9') || first.startsWith('fea') || first.startsWith('feb')) return true
    if (first.startsWith('fc') || first.startsWith('fd')) return true
    if (first.startsWith('ff')) return true
    return false
  }
  return true
}

async function resolvesToPublicAddress(host: string): Promise<boolean> {
  if (isIP(host)) return !isBlockedIp(host)

  try {
    const results = await lookup(host, { all: true })
    if (results.length === 0) return false
    return results.every((r) => !isBlockedIp(r.address))
  } catch {
    return false
  }
}

function parseHostAndPort(raw: string): { host: string; port: number } | null {
  let s = raw.trim()
  s = s.replace(/^https?:\/\//i, '')
  s = s.replace(/\/.*$/, '')

  let host = s
  let port = DEFAULT_PORT

  const m = s.match(/^(.+):(\d{2,5})$/)
  if (m) {
    const p = parseInt(m[2], 10)
    if (p >= 1 && p <= 65535) {
      host = m[1]
      port = p
    }
  }

  host = host.toLowerCase()
  if (!isValidHost(host)) return null
  return { host, port }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('host')?.trim() ?? ''
  const portParam = req.nextUrl.searchParams.get('port')?.trim()

  const parsed = parseHostAndPort(raw)
  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid host (use IP, domain, or host:port e.g. node.example.com:6080)' },
      { status: 400 },
    )
  }

  let { host, port } = parsed
  if (portParam) {
    const p = parseInt(portParam, 10)
    if (Number.isFinite(p) && p >= 1 && p <= 65535) port = p
  }

  if (
    ALLOWED_DASHBOARD_HOSTS.length > 0 &&
    !ALLOWED_DASHBOARD_HOSTS.includes(host)
  ) {
    return NextResponse.json(
      {
        error: 'Host not on ALLOWED_DASHBOARD_HOSTS allow-list',
        host,
      },
      { status: 403 },
    )
  }

  if (!(await resolvesToPublicAddress(host))) {
    return NextResponse.json(
      {
        error: 'Host not allowed',
        host,
        hint: 'Must resolve to a public IP (not private/localhost). Use a public domain or VPS IP.',
      },
      { status: 403 },
    )
  }

  const url = `http://${host}:${port}/api/stats`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    })
    clearTimeout(timer)

    if (!res.ok) {
      return NextResponse.json(
        { error: `Dashboard unreachable (${res.status})`, host, port },
        { status: 502 },
      )
    }

    const data = await res.json()
    return NextResponse.json({ ...data, _proxy_host: host, _proxy_port: port })
  } catch {
    return NextResponse.json(
      {
        error: 'Dashboard unreachable',
        host,
        port,
        hint: `Open TCP ${port} on the server firewall (or put a reverse proxy in front). Default dashboard port is 8080.`,
      },
      { status: 502 },
    )
  }
}
