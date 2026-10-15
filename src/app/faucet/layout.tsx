import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/faucet',
  'Testnet faucet',
  'Claim free Falcon PL testnet FPL from the faucet to try the post-quantum wallet, swaps, pools and lending. Test tokens have no cash value.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
