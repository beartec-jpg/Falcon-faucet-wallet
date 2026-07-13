import type { LendOverview } from '@/lib/lend-model'

/** Max fractional digits for IOU Amount fields (matches XRPL trust-line precision). */
const IOU_FRACTION_DIGITS = 12

export type VaultShareMath = {
  assetsTotal: number
  assetsAvailable: number
  sharesOutstanding: number
  shareScale: number
  lossUnrealized?: number
}

function formatIouAmount(n: number): string {
  const factor = 10 ** IOU_FRACTION_DIGITS
  const v = Math.floor(n * factor + 1e-12) / factor
  const s = v.toFixed(IOU_FRACTION_DIGITS)
  return s.replace(/\.?0+$/, '')
}

function netAssetTotal(vault: VaultShareMath): number {
  const loss = vault.lossUnrealized ?? 0
  return Math.max(0, vault.assetsTotal - loss)
}

/** Human F-USDC redeemable from a vault share balance (on-chain sharesToAssetsWithdraw). */
export function fusdcFromShareBalance(shareBalance: number, vault: VaultShareMath): number | null {
  if (!Number.isFinite(shareBalance) || shareBalance <= 0) return null
  const net = netAssetTotal(vault)
  const shareTotalRaw = vault.sharesOutstanding * 10 ** vault.shareScale
  if (net <= 0 || shareTotalRaw <= 0) return null
  const sharesRaw = shareBalance * 10 ** vault.shareScale
  return (net * sharesRaw) / shareTotalRaw
}

/**
 * Mirror assetsToSharesWithdraw (truncate) + sharesToAssetsWithdraw, then floor the
 * Amount so VaultWithdraw succeeds (naive round values can fail with tecINSUFFICIENT_FUNDS).
 */
export function normalizeVaultWithdrawAmount(
  offeredFusdc: number,
  vault: VaultShareMath,
  shareBalance?: number | null,
): string | null {
  if (!Number.isFinite(offeredFusdc) || offeredFusdc <= 0) return null

  const net = netAssetTotal(vault)
  const shareTotalRaw = vault.sharesOutstanding * 10 ** vault.shareScale
  if (net <= 0 || shareTotalRaw <= 0) return null

  let capped = offeredFusdc
  if (Number.isFinite(vault.assetsAvailable) && capped > vault.assetsAvailable + 1e-9) {
    capped = vault.assetsAvailable
  }
  if (shareBalance != null && shareBalance > 0) {
    const maxFromShares = fusdcFromShareBalance(shareBalance, vault)
    if (maxFromShares != null && capped > maxFromShares + 1e-9) {
      capped = maxFromShares
    }
  }
  if (capped <= 0) return null

  let sharesRaw = Math.floor((shareTotalRaw * capped) / net)
  if (shareBalance != null && shareBalance > 0) {
    const userSharesRaw = Math.floor(shareBalance * 10 ** vault.shareScale + 1e-9)
    if (sharesRaw > userSharesRaw) sharesRaw = userSharesRaw
  }
  if (sharesRaw <= 0) return null

  const assetsWithdrawn = (net * sharesRaw) / shareTotalRaw
  const floored = Math.floor(assetsWithdrawn * 10 ** IOU_FRACTION_DIGITS + 1e-12) / 10 ** IOU_FRACTION_DIGITS
  if (floored <= 0) return null

  return formatIouAmount(floored)
}

export function withdrawBlockedReason(
  data: LendOverview | null,
  amountStr: string,
): string | null {
  const vault = data?.vaults?.[0]
  const lp = data?.lpPositions?.[0]
  if (!data?.protocol.txSigningReady) return 'Lending protocol is not active on this network.'
  if (!vault) return 'Lend vault is not configured.'

  const offered = parseFloat(amountStr)
  if (!Number.isFinite(offered) || offered <= 0) return 'Enter a withdraw amount.'

  const shareBalance = lp?.shareBalance ?? 0
  if (shareBalance <= 0) {
    return 'No vault shares to withdraw — supply F-USDC on the Supply tab first.'
  }

  const maxFromShares = fusdcFromShareBalance(shareBalance, vault)
  const maxWithdraw = maxWithdrawFusdc(shareBalance, vault)
  if (maxFromShares != null && offered > maxFromShares + 1e-9) {
    return `Round amounts like ${amountStr} need more shares than you hold (${formatIouAmount(shareBalance)} shares ≈ ${maxWithdraw ?? formatIouAmount(maxFromShares)} F-USDC). Tap Withdraw all or Max.`
  }

  if (vault.assetsAvailable <= 0) {
    return 'Vault has no liquid F-USDC right now — borrowers may have drawn the pool. Try again after repayments.'
  }
  if (offered > vault.assetsAvailable + 1e-9) {
    return `Only ${vault.assetsAvailable.toLocaleString(undefined, { maximumFractionDigits: 6 })} F-USDC is liquid in the vault (${(vault.assetsTotal - vault.assetsAvailable).toLocaleString(undefined, { maximumFractionDigits: 2 })} borrowed).`
  }

  const normalized = normalizeVaultWithdrawAmount(offered, vault, shareBalance)
  if (!normalized) {
    return 'Amount is too small to redeem vault shares (try a larger withdrawal).'
  }

  return null
}

/** Largest F-USDC withdrawal that fits share balance and vault liquidity. */
export function maxWithdrawFusdc(
  shareBalance: number,
  vault: VaultShareMath,
): string | null {
  if (!Number.isFinite(shareBalance) || shareBalance <= 0) return null
  const fromShares = fusdcFromShareBalance(shareBalance, vault)
  if (fromShares == null || fromShares <= 0) return null
  const cap = Math.min(fromShares, vault.assetsAvailable)
  if (cap <= 0) return null
  return normalizeVaultWithdrawAmount(cap, vault, shareBalance)
}

export function resolveVaultWithdrawAmount(
  data: LendOverview | null,
  amountStr: string,
): { amount: string; offered: number; adjusted: boolean } | null {
  const vault = data?.vaults?.[0]
  const lp = data?.lpPositions?.[0]
  if (!vault) return null
  const offered = parseFloat(amountStr)
  if (!Number.isFinite(offered) || offered <= 0) return null
  const amount = normalizeVaultWithdrawAmount(offered, vault, lp?.shareBalance ?? null)
  if (!amount) return null
  const adjusted = Math.abs(parseFloat(amount) - offered) > 1e-9
  return { amount, offered, adjusted }
}