'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_NETWORK_KEY,
  getNetwork,
  isNetworkKey,
  type NetworkConfig,
  type NetworkKey,
} from '@/lib/networks'

const STORAGE_KEY = 'falcon-wallet-network'

interface NetworkContextValue {
  networkKey: NetworkKey
  network: NetworkConfig
  setNetworkKey: (key: NetworkKey) => void
}

const NetworkContext = createContext<NetworkContextValue | null>(null)

function readStoredNetwork(): NetworkKey {
  if (typeof window === 'undefined') return DEFAULT_NETWORK_KEY
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isNetworkKey(v) ? v : DEFAULT_NETWORK_KEY
  } catch {
    return DEFAULT_NETWORK_KEY
  }
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [networkKey, setNetworkKeyState] = useState<NetworkKey>(DEFAULT_NETWORK_KEY)

  useEffect(() => {
    setNetworkKeyState(readStoredNetwork())
  }, [])

  const setNetworkKey = useCallback((key: NetworkKey) => {
    setNetworkKeyState(key)
    try {
      localStorage.setItem(STORAGE_KEY, key)
    } catch {
      /* private browsing */
    }
  }, [])

  const network = useMemo(() => getNetwork(networkKey), [networkKey])

  const value = useMemo(
    () => ({ networkKey, network, setNetworkKey }),
    [networkKey, network, setNetworkKey],
  )

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  )
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext)
  if (!ctx) {
    return {
      networkKey: DEFAULT_NETWORK_KEY,
      network: getNetwork(DEFAULT_NETWORK_KEY),
      setNetworkKey: () => {},
    }
  }
  return ctx
}