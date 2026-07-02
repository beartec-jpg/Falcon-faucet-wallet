'use client'

import type { ReactNode } from 'react'
import { NetworkProvider } from '@/components/NetworkProvider'

export default function Providers({ children }: { children: ReactNode }) {
  return <NetworkProvider>{children}</NetworkProvider>
}