import SrOnlyH1 from '@/components/SrOnlyH1'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/pool',
  'Liquidity pools',
  'Provide liquidity to Falcon PL testnet AMM pools and track your positions. Experimental; test tokens have no cash value.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SrOnlyH1 path="/pool">Falcon PL liquidity pools</SrOnlyH1>
      {children}
    </>
  )
}
