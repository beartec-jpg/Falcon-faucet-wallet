import { redirect } from 'next/navigation'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/first-35',
  'The First 35 — First-adopter seats on Falcon PL',
  '35 first-adopter prize seats on Falcon PL: 12M FPL in total across three tiers (500k, 350k, 200k), plus 1.9M FPL in arcade top 5 prizes, paid at mainnet launch.',
)

export default function First35Page() {
  redirect('/airdrop?tab=first35')
}
