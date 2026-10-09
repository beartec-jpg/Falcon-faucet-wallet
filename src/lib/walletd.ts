/**
 * walletd (Falcon PL wallet API) client config.
 *
 * Production reaches walletd through the authenticated HTTPS gateway on falcon1
 * (Tailscale Funnel → pl-walletd-gateway → walletd on loopback). The gateway
 * requires `Authorization: Bearer <FALCON_PL_WALLET_API_KEY>` on every call and
 * only forwards the walletd actions the site uses.
 *
 *   FALCON_PL_WALLET_API      gateway base URL (no trailing slash needed)
 *   FALCON_PL_WALLET_API_KEY  shared key (server-only; never NEXT_PUBLIC_)
 */

/** Old droplet relay. Kept only as a fallback until the droplet is retired. */
const LEGACY_WALLET_API = 'http://192.241.247.158:19312'

export function walletApiUrl(): string {
  return (process.env.FALCON_PL_WALLET_API?.trim() || LEGACY_WALLET_API).replace(/\/+$/, '')
}

/** Shared-key auth header for the walletd gateway, if configured. */
export function walletApiAuthHeaders(): Record<string, string> {
  const key = process.env.FALCON_PL_WALLET_API_KEY?.trim()
  return key ? { Authorization: `Bearer ${key}` } : {}
}

/** Headers for a JSON POST to walletd (Content-Type + gateway auth). */
export function walletApiHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...walletApiAuthHeaders() }
}
