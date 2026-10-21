import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/network/health',
  'Network health',
  'Live Falcon PL testnet 2300 health: every validator’s status, height, lag, last proposal and epoch activity, with active alerts.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
