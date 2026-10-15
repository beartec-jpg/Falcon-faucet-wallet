import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/community',
  'Community',
  'Join the Falcon PL community: socials and channels for the post-quantum participation ledger testnet.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
