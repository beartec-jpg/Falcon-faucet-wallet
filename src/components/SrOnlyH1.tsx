'use client'

import { usePathname } from 'next/navigation'

/** Visually hidden page heading for crawlers/screen readers; only on the exact route. */
export default function SrOnlyH1({ path, children }: { path: string; children: React.ReactNode }) {
  const pathname = usePathname()
  if (pathname !== path) return null
  return <h1 className="sr-only">{children}</h1>
}
