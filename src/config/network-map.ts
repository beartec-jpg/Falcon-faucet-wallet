/**
 * Live network map (/scan/map) layout config. Edit this file to move seats
 * between locations, add hosts, or change the hub.
 *
 * Only layout lives here. Live state (online, packer, tips, txs) always comes
 * from /api/scan. Seats that show up in status but are not listed here go to
 * one group with no location label, so a new validator never disappears from the map.
 */

export interface MapHost {
  /** Machine name shown under the seat labels. */
  host: string
  seats: string[]
  note?: string
}

export interface MapLocation {
  id: string
  /** Location name; empty for seats whose location is not known. */
  label: string
  hosts: MapHost[]
  /** Optional accent for the location platform. */
  color?: string
}

export interface NetworkMapConfig {
  /** Seat drawn at the top of the map; pipes run from it down to every validator. */
  hub: { seat: string; host: string }
  /**
   * Wallet services: where client transactions enter (wallet app + loadgen,
   * falcon-pl-loadgen.service). Drawn above the hub, beaming txs into it.
   */
  wallet: { label: string; sub: string } | null
  /** Status poll interval, ms (the brief asks for 1–2 s). */
  pollMs: number
  /** Hard cap on live transaction bulges in the pipes (performance). */
  maxBulges: number
  /** Max watcher particles in the hub ring; extra watchers show as '+N'. */
  maxWatcherParticles: number
  /** Show jailed / offline seats that are not in `locations`. */
  showUnplacedOffline: boolean
  locations: MapLocation[]
}

export const NETWORK_MAP_CONFIG: NetworkMapConfig = {
  hub: { seat: 'v1', host: 'falcon1' },
  wallet: { label: 'Wallet services', sub: 'wallet app · loadgen' },
  pollMs: 1500,
  maxBulges: 160,
  maxWatcherParticles: 48,
  showUnplacedOffline: false,
  locations: [
    {
      id: 'england',
      label: 'England',
      hosts: [
        // v1 (hub / archive) runs on falcon1; it is drawn as the hub, not here.
        { host: 'falcon2', seats: ['v3', 'scottdog'] },
        { host: 'beartec-brain', seats: ['falcon-node'], note: 'loadgen: transactions enter here' },
      ],
    },
    {
      id: 'helsinki',
      label: 'Helsinki, Finland',
      hosts: [
        { host: 'ubuntu-4gb-hel1-6', seats: ['v10'] },
        { host: 'ubuntu-4gb-hel1-4', seats: ['scottspersonalnode'] },
      ],
    },
    { id: 'germany', label: 'Germany', hosts: [{ host: 'ubuntu-4gb-mhr', seats: ['v6'] }] },
    { id: 'falkenstein', label: 'Falkenstein, Germany', hosts: [{ host: 'ubuntu-8gb-fsn1-1', seats: ['v13'] }] },
    { id: 'hillsboro', label: 'Hillsboro, US', hosts: [{ host: 'ubuntu-8gb-hil-2-1', seats: ['v12'] }] },
  ],
}
