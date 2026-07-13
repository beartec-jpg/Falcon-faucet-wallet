import type { LendOverview } from '@/lib/lend-model'

/** Max fractional digits for IOU Amount fields (matches XRPL trust-line precision). */
const IOU_FRACTION_DIGITS = 12

/**
 * Mirror on-chain assetsToSharesDeposit + sharesToAssetsDeposit, then floor the
 * deposit Amount so ValidVault invariants pass (round-trip share math can make
 * naive values like "20" fail with tecINVARIANT_FAILED).
 */
export function normalizeVaultDepositAmount(
  offeredFusdc: number,
  vault: { assetsTotal: number; sharesOutstanding: number; shareScale: number },
): string | null {
  if (!Number.isFinite(offeredFusdc) || offeredFusdc <= 0) return null

  const { assetsTotal, sharesOutstanding, shareScale } = vault
  if (!Number.isFinite(assetsTotal) || assetsTotal < 0) return null
  if (!Number.isFinite(sharesOutstanding) || sharesOutstanding < 0) return null

  // On-chain OutstandingAmount is an integer MPT count; overview exposes human shares.
  const shareTotalRaw = sharesOutstanding * 10 ** shareScale

  let sharesRaw: number
  if (assetsTotal === 0) {
    // First deposit: shares = truncate(offered * 10^scale)
    sharesRaw = Math.floor(offeredFusdc * 10 ** shareScale)
  } else {
    sharesRaw = Math.floor((shareTotalRaw * offeredFusdc) / assetsTotal)
  }
  if (sharesRaw <= 0) return null

  let assetsDeposited: number
  if (assetsTotal === 0) {
    assetsDeposited = sharesRaw / 10 ** shareScale
  } else {
    assetsDeposited = (assetsTotal * sharesRaw) / shareTotalRaw
  }

  const factor = 10 ** IOU_FRACTION_DIGITS
  const floored = Math.floor(assetsDeposited * factor + 1e-12) / factor
  if (floored <= 0) return null

  return formatIouAmount(floored)
}

function formatIouAmount(n: number): string {
  const s = flooredFixed(n, IOU_FRACTION_DIGITS)
  return s.replace(/\.?0+$/, '')
}

function flooredFixed(n: number, digits: number): string {
  const factor = 10 ** digits
  const v = Math.floor(n * factor + 1e-12) / factor
  return v.toFixed(digits)
}

export function supplyBlockedReason(
  data: LendOverview | null,
  amountStr: string,
): string | null {
  const vault = data?.vaults?.[0]
  if (!data?.protocol.txSigningReady) return 'Lending protocol is not active on this network.'
  if (!vault) return 'Lend vault is not configured.'

  const offered = parseFloat(amountStr)
  if (!Number.isFinite(offered) || offered <= 0) return 'Enter a supply amount.'

  if (!data.wallet?.hasFusdcTrustLine) {
    return 'Add a F-USDC trust line on Wallet → Bridge or Swap first.'
  }

  const balance = data.wallet.fusdcBalance
  if (balance != null && offered > balance + 1e-9) {
    return `Insufficient F-USDC (${balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} available).`
  }

  const normalized = normalizeVaultDepositAmount(offered, vault)
  if (!normalized) {
    return 'Amount is too small to mint vault shares (try a larger deposit).'
  }

  const normalizedNum = parseFloat(normalized)
  if (balance != null && normalizedNum > balance + 1e-9) {
    return `After vault share rounding, ${normalized} F-USDC is required but you only hold ${balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}.`
  }

  return null
}

/** Largest deposit amount that fits wallet balance after vault share rounding. */
export function maxSupplyFusdc(
  fusdcBalance: number,
  vault: { assetsTotal: number; sharesOutstanding: number; shareScale: number },
): string | null {
  if (!Number.isFinite(fusdcBalance) || fusdcBalance <= 0) return null
  return normalizeVaultDepositAmount(fusdcBalance, vault)
}

/** Amount string safe to pass to VaultDeposit Amount after normalization. */
export function resolveVaultDepositAmount(
  data: LendOverview | null,
  amountStr: string,
): { amount: string; offered: number; adjusted: boolean } | null {
  const vault = data?.vaults?.[0]
  if (!vault) return null
  const offered = parseFloat(amountStr)
  if (!Number.isFinite(offered) || offered <= 0) return null
  const amount = normalizeVaultDepositAmount(offered, vault)
  if (!amount) return null
  const adjusted = Math.abs(parseFloat(amount) - offered) > 1e-9
  return { amount, offered, adjusted }
}