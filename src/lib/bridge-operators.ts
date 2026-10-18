/**
 * BTC bridge operators shown on the network map's Operators orbit.
 * The on-chain OperatorRegister is not active yet, so this is a static, empty-safe list.
 * Replace with the registry/feed once it goes live.
 */
export interface BridgeOperator {
  name: string
  /** true when the operator's /feed heartbeat is recent. */
  live?: boolean
}

export const BRIDGE_OPERATORS: BridgeOperator[] = []
