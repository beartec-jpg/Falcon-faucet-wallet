import SrOnlyH1 from '@/components/SrOnlyH1'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/swap',
  'Swap',
  'Swap tokens on the Falcon PL testnet AMM from your post-quantum wallet. Experimental; test tokens have no cash value.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SrOnlyH1 path="/swap">Swap on Falcon PL testnet</SrOnlyH1>
      {children}
    </>
  )
}
