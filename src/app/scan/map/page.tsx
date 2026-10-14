import type { Metadata } from 'next'
import NetworkMapClient from '@/components/netmap/NetworkMapClient'

export const metadata: Metadata = {
  title: 'Live network map · Falcon PL',
  description: 'Live 3D map of the Falcon PL 2300 validator mesh.',
}

export default function NetworkMapPage() {
  return <NetworkMapClient />
}
