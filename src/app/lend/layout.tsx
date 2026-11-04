// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import SrOnlyH1 from '@/components/SrOnlyH1'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/lend',
  'Lending',
  'Supply and borrow on the experimental Falcon PL testnet lending market. Test tokens have no cash value.',
)

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SrOnlyH1 path="/lend">Falcon PL testnet lending</SrOnlyH1>
      {children}
    </>
  )
}
