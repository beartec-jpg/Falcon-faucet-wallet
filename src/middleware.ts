import { NextResponse, type NextRequest } from 'next/server'
import { buildCsp, newNonce } from '@/lib/csp'

/**
 * Per-request CSP nonce (audit M-3). Next.js reads the nonce from the request's
 * Content-Security-Policy header and adds it to its own scripts; the root layout passes
 * it to next/script via x-nonce.
 */
export function middleware(req: NextRequest) {
  const nonce = newNonce()
  const csp = buildCsp(nonce, process.env as Record<string, string | undefined>)
  const headers = new Headers(req.headers)
  headers.set('x-nonce', nonce)
  headers.set('Content-Security-Policy', csp)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('Content-Security-Policy', csp)
  return res
}

export const config = {
  matcher: [
    {
      // Pages only: skip API routes, static assets, and prefetches.
      source: '/((?!api/|_next/static|_next/image|cold-signer|.*\\..*).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
