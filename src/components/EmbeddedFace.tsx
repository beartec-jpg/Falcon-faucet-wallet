'use client'

import { createContext, useContext } from 'react'

/**
 * True when a product page (Vault / Swap / Pool / Lend) is rendered as a face inside the
 * Wallet cylinder. Header, NetworkBanner and ProductShell render nothing extra in that case
 * so the page component itself can be reused unchanged.
 */
export const EmbeddedFaceContext = createContext(false)
export const useEmbeddedFace = () => useContext(EmbeddedFaceContext)
