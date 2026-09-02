import ScanExplorer from './ScanExplorer'
import { buildScanSnapshot } from '@/lib/scan-snapshot'
import type { ScanData } from '@/lib/scan-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

const SSR_TIMEOUT_MS = 8_000

function snapshotWithTimeout(): Promise<ScanData> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Explorer snapshot timeout')), SSR_TIMEOUT_MS)
    buildScanSnapshot().then(
      (data) => {
        clearTimeout(timer)
        resolve(data)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export default async function ScanPage() {
  let initialData: ScanData | null = null
  let initialError: string | null = null
  try {
    initialData = await snapshotWithTimeout()
  } catch (e) {
    initialError = e instanceof Error ? e.message : 'Node unavailable'
  }
  return <ScanExplorer initialData={initialData} initialError={initialError} />
}
