'use client'

import dynamic from 'next/dynamic'

const WalletClient = dynamic(() => import('./WalletClient'), { ssr: false })

export default function WalletPage() {
  return <WalletClient />
}
