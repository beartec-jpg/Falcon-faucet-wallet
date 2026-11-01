import { redirect } from 'next/navigation'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/first-35',
  'The First 35 — First-adopter seats on Falcon PL',
  '35 first-adopter prize seats on Falcon PL: 12M FPL in total across three tiers (1M for seats 1 to 5, 500k for 6 to 15, 100k for 16 to 35), plus 1.9M FPL in arcade top 5 prizes, that we intend to reward at mainnet launch. No guarantees.',
)

export default function First35Page() {
  redirect('/airdrop?tab=first35')
}
