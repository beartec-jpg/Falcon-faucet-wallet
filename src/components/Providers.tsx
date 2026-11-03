// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

import type { ReactNode } from 'react'
import { NetworkProvider } from '@/components/NetworkProvider'

export default function Providers({ children }: { children: ReactNode }) {
  return <NetworkProvider>{children}</NetworkProvider>
}