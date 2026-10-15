import SrOnlyH1 from '@/components/SrOnlyH1'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/wallet',
  'Wallet',
  'Falcon PL testnet wallet: passkey-secured, post-quantum Falcon-512 signing in your browser. Send, receive and manage test FPL.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SrOnlyH1 path="/wallet">Falcon PL testnet wallet</SrOnlyH1>
      {children}
    </>
  )
}
