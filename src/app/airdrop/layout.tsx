import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/airdrop',
  'Community allocation',
  'Falcon PL community allocation: how testnet activity may count toward the pre-mainnet allocation. Testnet FPL has no value.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
