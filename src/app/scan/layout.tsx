import SrOnlyH1 from '@/components/SrOnlyH1'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/scan',
  'Explorer',
  'Falcon PL testnet 2300 explorer: blocks, transactions, accounts, validators and the testnet activity leaderboard.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SrOnlyH1 path="/scan">Falcon PL testnet explorer</SrOnlyH1>
      {children}
    </>
  )
}
