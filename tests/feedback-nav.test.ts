import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const header = readFileSync(join(root, 'src/components/Header.tsx'), 'utf8')
const sw = readFileSync(join(root, 'public/sw.js'), 'utf8')

describe('Feedback reachable under Community', () => {
  it('lists Feedback in the Community sub-items', () => {
    expect(header).toMatch(/label: 'Feedback', href: '\/feedback'/)
  })
  it('renders a desktop/tablet Community dropdown toggle', () => {
    expect(header).toContain('data-testid="community-menu-toggle"')
    expect(header).toContain('data-community-menu')
  })
  it('service worker serves HTML network-first and bumped its cache', () => {
    expect(sw).toMatch(/request\.mode === 'navigate'/)
    expect(sw).not.toContain("'falcon-wallet-v16'")
  })
})

describe('Community page Feedback CTA', () => {
  it('has a Feedback button in the hero, above the social cards', () => {
    const page = readFileSync(join(root, 'src/app/community/page.tsx'), 'utf8')
    const cta = page.indexOf('community-feedback-cta')
    expect(cta).toBeGreaterThan(0)
    expect(cta).toBeLessThan(page.indexOf('socials.map'))
  })
})
