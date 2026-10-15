import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/vault',
  'Vault',
  'Falcon PL vault for testnet FPL.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
