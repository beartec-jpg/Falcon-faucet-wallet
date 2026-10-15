import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/validator/apply',
  'Validator application',
  'Apply to run a Falcon PL testnet validator.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
