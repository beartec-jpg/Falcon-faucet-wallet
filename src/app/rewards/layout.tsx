import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/rewards',
  'Claim rewards',
  'Claim Falcon PL testnet rewards to your wallet.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
