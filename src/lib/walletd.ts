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

/**
 * walletd base URL. No hard-coded fallback (the droplet relay was retired on
 * 2026-10-09): when unset, walletd calls fail and each route returns its 503 JSON.
 */
export function walletApiUrl(): string {
  const url = process.env.FALCON_PL_WALLET_API?.trim()
  return url ? url.replace(/\/+$/, '') : 'http://walletd-not-configured.invalid'
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
