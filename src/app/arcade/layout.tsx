import SrOnlyH1 from '@/components/SrOnlyH1'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/arcade',
  'Arcade',
  'Play Falcon PL arcade games with your testnet wallet, climb the epoch leaderboards and compete for arcade prizes.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SrOnlyH1 path="/arcade">Falcon PL arcade</SrOnlyH1>
      {children}
    </>
  )
}
