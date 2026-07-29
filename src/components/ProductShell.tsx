'use client'

import type { ReactNode } from 'react'
import BrandAtmosphere from '@/components/BrandAtmosphere'

/**
 * Shared shell for product pages: gold particle atmosphere + content above it.
 */
export default function ProductShell({
  children,
  intensity = 0.42,
  className = '',
}: {
  children: ReactNode
  intensity?: number
  className?: string
}) {
  return (
    <div className={`relative min-h-screen flex flex-col ${className}`}>
      <BrandAtmosphere intensity={intensity} />
      <div className="relative z-10 flex min-h-screen flex-1 flex-col min-h-0">{children}</div>
    </div>
  )
}
