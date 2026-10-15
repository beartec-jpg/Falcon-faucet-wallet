import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/whitepaper',
  'Whitepaper',
  'Falcon PL whitepaper: a quantum-safe participation ledger with Falcon-512 signatures from genesis, protocol-controlled treasury and Proof of Participation & Liquidity.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
