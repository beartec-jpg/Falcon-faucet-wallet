/**
 * Live network map (/scan/map) layout config. Edit this file to move seats
 * between locations, add hosts, or change the hub.
 *
 * Only layout lives here. Live state (online, packer, tips, txs) always comes
 * from /api/scan. Seats that show up in status but are not listed here go to
 * an "Unplaced" group, so a new validator never disappears from the map.
 */

export interface MapHost {
  /** Machine name shown under the seat labels. */
  host: string
  seats: string[]
  note?: string
}

export interface MapLocation {
  id: string
  label: string
  /** false = location still to be confirmed by Scott (shown with a TODO badge). */
  confirmed: boolean
  hosts: MapHost[]
  /** Optional accent for the location platform. */
  color?: string
}

export interface NetworkMapConfig {
  /** Seat drawn at the top of the map; pipes run from it down to every validator. */
  hub: { seat: string; host: string }
  /** Seat whose box takes in client transactions (loadgen); drawn with an ingress pipe. */
  ingress: { seat: string; label: string } | null
  /** Status poll interval, ms (the brief asks for 1–2 s). */
  pollMs: number
  /** Hard cap on live transaction bulges in the pipes (performance). */
  maxBulges: number
  /** Show jailed / offline seats that are not in `locations`. */
  showUnplacedOffline: boolean
  locations: MapLocation[]
}

export const NETWORK_MAP_CONFIG: NetworkMapConfig = {
  hub: { seat: 'v11', host: 'falcon2' },
  ingress: { seat: 'falcon-node', label: 'loadgen · falcon-pl-loadgen.service' },
  pollMs: 1500,
  maxBulges: 160,
  showUnplacedOffline: false,
  locations: [
    {
      id: 'england',
      label: 'England',
      confirmed: true,
      hosts: [
        { host: 'falcon1', seats: ['v1'] },
        // v11 (hub) also runs on falcon2; it is drawn as the hub, not here.
        { host: 'falcon2', seats: ['v3'] },
        { host: 'beartec-brain', seats: ['falcon-node'], note: 'loadgen: transactions enter here' },
      ],
    },
    {
      id: 'helsinki',
      label: 'Helsinki, Finland',
      confirmed: true,
      hosts: [
        // TODO(scott): host name for v10.
        { host: '', seats: ['v10'] },
        { host: 'ubuntu-4gb-hel1-4', seats: ['scottspersonalnode'] },
      ],
    },
    // TODO(scott): confirm. Germany (city unknown).
    { id: 'germany', label: 'Germany', confirmed: false, hosts: [{ host: '', seats: ['v6'] }] },
    // TODO(scott): confirm.
    { id: 'falkenstein', label: 'Falkenstein, Germany', confirmed: false, hosts: [{ host: '', seats: ['v13'] }] },
    // TODO(scott): confirm.
    { id: 'hillsboro', label: 'Hillsboro, US', confirmed: false, hosts: [{ host: '', seats: ['v12'] }] },
  ],
}
