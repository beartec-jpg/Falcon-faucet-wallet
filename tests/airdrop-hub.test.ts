import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const header = readFileSync(join(root, 'src/components/Header.tsx'), 'utf8')
const airdrop = readFileSync(join(root, 'src/app/airdrop/page.tsx'), 'utf8')
const scan = readFileSync(join(root, 'src/app/scan/ScanExplorer.tsx'), 'utf8')
const first35 = readFileSync(join(root, 'src/app/first-35/page.tsx'), 'utf8')
const rewards = readFileSync(join(root, 'src/app/rewards/page.tsx'), 'utf8')
const community = readFileSync(join(root, 'src/app/community/page.tsx'), 'utf8')

describe('Unified Airdrop Hub (/airdrop)', () => {
  it('consolidates First 35 under Airdrop in top navigation', () => {
    expect(header).toMatch(/key: 'airdrop', label: 'Airdrop', href: '\/airdrop'/)
    expect(header).not.toMatch(/key: 'first35', label: 'First 35', href: '\/first-35'/)
  })

  it('exposes the 4 sub-tabs on /airdrop (activity, operators, first35, claim)', () => {
    expect(airdrop).toContain("id: 'activity', label: 'Wallet Activity'")
    expect(airdrop).toContain("id: 'operators', label: 'Operators'")
    expect(airdrop).toContain("id: 'first35', label: 'First 35 & Arcade'")
    expect(airdrop).toContain("id: 'claim', label: 'Claim Epoch Rewards'")
    expect(airdrop).toContain('<TrackerBoard hideOperatorsTab />')
    expect(airdrop).toContain('<OperatorsPool />')
    expect(airdrop).toContain('<First35Seats')
    expect(airdrop).toContain('<First35Form />')
    expect(airdrop).toContain('<ArcadePrizes />')
    expect(airdrop).toContain('<PlRewards embedded />')
  })

  it('keeps Explorer focused on chain tabs and links to /airdrop', () => {
    expect(scan).not.toMatch(/id: 'activity' as const/)
    expect(scan).toContain('href="/airdrop"')
    expect(scan).toContain('Airdrop &amp; Leaderboards →')
  })

  it('redirects /first-35 and /rewards to their /airdrop tabs', () => {
    expect(first35).toContain("redirect('/airdrop?tab=first35')")
    expect(rewards).toContain("router.replace('/airdrop?tab=claim')")
    expect(community).toContain("href: '/airdrop?tab=claim'")
  })
})
