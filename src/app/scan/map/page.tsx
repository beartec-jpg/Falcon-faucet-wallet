import type { Metadata } from 'next'
import { pageMeta } from '@/lib/seo'
import NetworkMapClient from '@/components/netmap/NetworkMapClient'

export const metadata: Metadata = pageMeta(
  '/scan/map',
  'Live network map',
  'Live 3D map of the Falcon PL 2300 validator mesh.',
)

export default function NetworkMapPage() {
  return <NetworkMapClient />
}
