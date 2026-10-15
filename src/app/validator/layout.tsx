import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/validator',
  'Run a validator',
  'Become a Falcon PL validator: requirements, bonding and how validators are paid on the post-quantum participation ledger.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
