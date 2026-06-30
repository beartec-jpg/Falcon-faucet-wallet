import { NextRequest, NextResponse } from 'next/server'

const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,253}[a-z0-9])?$/i
const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/

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

  const url = `http://${host}:8080/api/stats`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timer)

    if (!res.ok) {
      return NextResponse.json(
        { error: `Dashboard unreachable (${res.status})`, host },
        { status: 502 },
      )
    }

    const data = await res.json()
    return NextResponse.json({ ...data, _proxy_host: host })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'fetch failed'
    return NextResponse.json(
      { error: message, host, hint: 'Open TCP 8080 on your server firewall' },
      { status: 502 },
    )
  }
}