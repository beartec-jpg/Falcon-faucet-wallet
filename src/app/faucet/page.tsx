import FaucetClient from './FaucetClient'
import { watcherSnapshot } from '@/lib/pl-watcher'

export const dynamic = 'force-dynamic'

export default async function FaucetPage() {
  let initialWatcher = null
  try {
    initialWatcher = await watcherSnapshot()
  } catch {
    initialWatcher = null
  }
  return <FaucetClient initialWatcher={initialWatcher} />
}
