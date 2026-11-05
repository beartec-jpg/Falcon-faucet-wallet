import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  EXAMPLES,
  GATEWAY_CORS_ORIGINS,
  GATEWAY_ERRORS,
  GATEWAY_URL,
  GATEWAY_METHODS,
  TESTNET_NOTICE,
  TIERS,
  apiKeysEnabled,
  explorerEndpoints,
  formatGbp,
} from '@/lib/developers/content'
import { Table, TestnetNotice } from '@/components/developers/DevBits'

// Vitest uses the classic JSX transform for .tsx imports.
;(globalThis as { React?: typeof React }).React = React
const root = join(__dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
const devFiles = [...walk(join(root, 'src/app/developers')), ...walk(join(root, 'src/components/developers')), join(root, 'src/lib/developers/content.ts')]
const PAGES = ['', '/gateway', '/explorer-api', '/pricing', '/api-keys', '/sdk']

describe('pricing tiers', () => {
  it('Free / Builder £29 / Scale £199 in GBP', () => {
    expect(TIERS.map((t) => [t.name, t.priceGbpMonthly])).toEqual([['Free', 0], ['Builder', 29], ['Scale', 199]])
    expect(formatGbp(29)).toBe('£29')
  })
  it('limits grow with the tier and match the confirmed fpl-gateway config', () => {
    expect(TIERS.map((t) => [t.rps, t.burst, t.monthlyUnits, t.txPerMin])).toEqual([
      [5, 10, 300_000, 10],
      [25, 50, 5_000_000, 120],
      [100, 200, 50_000_000, 600],
    ])
  })
  it('pricing page marks limits confirmed (not provisional) and states testnet / no value', () => {
    const p = read('src/app/developers/pricing/page.tsx')
    expect(p).toMatch(/Confirmed limits/)
    expect(p).not.toMatch(/provisional/i)
    expect(p).toMatch(/including Free, needs an API key/)
    expect(p).toContain('<TestnetNotice />')
    expect(TESTNET_NOTICE).toMatch(/testnet/i)
    expect(TESTNET_NOTICE).toMatch(/no monetary value/)
  })
})

describe('compliance copy', () => {
  it('every developer page shows the testnet notice', () => {
    for (const p of PAGES) expect(read(`src/app/developers${p}/page.tsx`), p).toContain('<TestnetNotice />')
  })
  it('never frames FPL as an investment', () => {
    const banned = /\b(invest|investment|returns? on|profit|yield|appreciat|price of fpl|buy fpl)/i
    for (const f of devFiles) expect(readFileSync(f, 'utf8'), relative(root, f)).not.toMatch(banned)
  })
  it('no Stripe secrets in dev pages; Stripe only via the Falcon Cloud checkout; no network calls in the key stub', () => {
    for (const f of devFiles) {
      const s = readFileSync(f, 'utf8')
      expect(s, relative(root, f)).not.toMatch(/sk_live|sk_test|rk_live|whsec_/i)
      if (!f.endsWith('pricing/page.tsx')) expect(s, relative(root, f)).not.toMatch(/stripe/i)
    }
    expect(read('src/components/developers/FreeKeyButton.tsx')).toMatch(/\/api\/falcon-cloud\/free-key/)
  })
})

describe('api key feature flag', () => {
  it('is off by default and only on for "1"', () => {
    expect(apiKeysEnabled({})).toBe(false)
    expect(apiKeysEnabled({ NEXT_PUBLIC_DEV_PORTAL_KEYS: 'true' })).toBe(false)
    expect(apiKeysEnabled({ NEXT_PUBLIC_DEV_PORTAL_KEYS: '1' })).toBe(true)
  })
  it('api keys page offers the self-serve Free key', () => {
    const p = read('src/app/developers/api-keys/page.tsx')
    expect(p).toMatch(/<FreeKeyButton \/>/)
  })
})

describe('gateway docs', () => {
  it('only read methods plus submit; no admin/ctl', () => {
    expect(GATEWAY_METHODS.map((m) => m.name)).toEqual(['fpl_status', 'fpl_health', 'fpl_getAccount', 'fpl_orderBook', 'fpl_openOrders', 'fpl_fills', 'fpl_submitTx'])
    for (const m of GATEWAY_METHODS) expect(m.name).not.toMatch(/seal|admin|drop|snapshot|reset|vault|rail/i)
  })
  it('gateway docs are live: no preview / provisional wording', () => {
    for (const f of devFiles) expect(readFileSync(f, 'utf8'), relative(root, f)).not.toMatch(/not live|provisional|preview|placeholder/i)
    expect(GATEWAY_URL).toBe('https://rpc.falcon-fpl.com')
  })
  it('states batch + WebSocket unsupported and CORS approved origins only', () => {
    const g = read('src/app/developers/gateway/page.tsx')
    expect(g).toMatch(/Batch requests[\s\S]*400/)
    expect(g).toMatch(/no WebSocket/)
    expect(g).toMatch(/only from approved origins/)
    expect(GATEWAY_CORS_ORIGINS).toEqual(['https://falcon-fpl.com', 'https://www.beartec.uk'])
    expect(GATEWAY_ERRORS.find((e) => e.code === -32600)?.http).toBe(400)
  })
  it('Free keys are self-serve, shown once, no email published', () => {
    const k = read('src/app/developers/api-keys/page.tsx')
    expect(k).toMatch(/shown once/)
    for (const f of devFiles) expect(readFileSync(f, 'utf8'), relative(root, f)).not.toMatch(/mailto:|[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
  })
  it('documents 429 and the error codes', () => {
    expect(GATEWAY_ERRORS.find((e) => e.http === 429)?.code).toBe(-32005)
    expect(read('src/app/developers/gateway/page.tsx')).toMatch(/Retry-After/)
  })
  it('examples in curl, JS and Python use env keys and handle 429', () => {
    expect(EXAMPLES.curl).toContain('$FPL_API_KEY')
    expect(EXAMPLES.js).toMatch(/status === 429[\s\S]*retry-after/)
    expect(EXAMPLES.python).toMatch(/status_code == 429[\s\S]*Retry-After/)
    expect(Object.values(EXAMPLES).join()).not.toMatch(/fplk_[0-9a-f]{8,}/)
  })
})

describe('explorer api docs come from the real endpoints', () => {
  it('lists every route.ts under src/app/api/v1', () => {
    const routes = walk(join(root, 'src/app/api/v1'))
      .filter((f) => f.endsWith('route.ts'))
      .map((f) => '/v1/' + relative(join(root, 'src/app/api/v1'), f).replace(/\/?route\.ts$/, '').replace(/\[(\w+)\]/g, '{$1}'))
      .map((p) => p.replace(/\/$/, ''))
      .sort()
    expect(explorerEndpoints().map((e) => e.path).sort()).toEqual(routes)
  })
  it('resolves shared pagination params', () => {
    const blocks = explorerEndpoints().find((e) => e.path === '/v1/explorer/blocks')!
    expect(blocks.params).toEqual(['limit? (query)', 'cursor? (query)'])
    const tx = explorerEndpoints().find((e) => e.path === '/v1/explorer/transactions')!
    expect(tx.params[0]).toBe('account (query)')
  })
})

describe('render + nav', () => {
  it('renders notice and table', () => {
    expect(renderToStaticMarkup(createElement(TestnetNotice))).toContain('no monetary value')
    expect(renderToStaticMarkup(createElement(Table, { head: ['a'], rows: [['x']] }))).toContain('<td')
  })
  it('adds Developers under the existing Community menu without new top-level items', () => {
    const h = read('src/components/Header.tsx')
    expect(h).toMatch(/label: 'Developers', href: '\/developers'/)
    const top = h.slice(h.indexOf('const NAV_ITEMS'), h.indexOf('const COMMUNITY_SUB_ITEMS'))
    expect(top).not.toContain('developers')
  })
  it('hero / home page untouched by this feature', () => {
    expect(read('src/app/page.tsx')).not.toContain('developers')
  })
  it('sitemap lists the pages', () => {
    const s = read('src/app/sitemap.ts')
    for (const p of PAGES) expect(s).toContain(`'/developers${p}'`)
  })
})
