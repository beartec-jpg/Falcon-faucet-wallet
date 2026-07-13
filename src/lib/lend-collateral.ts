import {
  LEND_LIQUIDATION_THRESHOLD,
  LEND_MIN_COLLATERAL_RATIO,
  healthFactor,
  hfStatus,
} from '@/lib/lend-model'

export {
  LEND_LIQUIDATION_THRESHOLD,
  LEND_MIN_COLLATERAL_RATIO,
  healthFactor,
  hfStatus,
}

/** FALCON collateral required for a target health factor (default 150%). */
export function collateralFalconForDebt(
  debtFusdc: number,
  falconPerFusdc: number,
  minRatio = LEND_MIN_COLLATERAL_RATIO,
): number | null {
  if (!Number.isFinite(debtFusdc) || debtFusdc <= 0) return null
  if (!Number.isFinite(falconPerFusdc) || falconPerFusdc <= 0) return null
  return (debtFusdc * minRatio) / falconPerFusdc
}

/** FALCON price drop % (debt unchanged) to reach liquidation threshold HF. */
export function liquidationPriceDropPct(hf: number | null): number | null {
  if (hf == null || !Number.isFinite(hf) || hf <= LEND_LIQUIDATION_THRESHOLD) return null
  return (1 - LEND_LIQUIDATION_THRESHOLD / hf) * 100
}

export function hfStatusLabel(status: ReturnType<typeof hfStatus>): string {
  switch (status) {
    case 'healthy':
      return 'Healthy'
    case 'warning':
      return 'Watch'
    case 'grace':
      return 'Grace period'
    case 'liquidatable':
      return 'Liquidatable'
    default:
      return '—'
  }
}

export function hfStatusColor(status: ReturnType<typeof hfStatus>): string {
  switch (status) {
    case 'healthy':
      return 'text-emerald-300'
    case 'warning':
      return 'text-amber-300'
    case 'grace':
      return 'text-orange-300'
    case 'liquidatable':
      return 'text-red-300'
    default:
      return 'text-slate-400'
  }
}

export function loanHealthSnapshot(
  collateralFalcon: number,
  debtFusdc: number,
  falconPerFusdc: number | null,
): {
  healthFactor: number | null
  status: ReturnType<typeof hfStatus>
  liquidationDropPct: number | null
  collateralValueFusdc: number | null
} {
  const price = falconPerFusdc ?? 0
  const hf =
    price > 0 && debtFusdc > 0
      ? healthFactor(collateralFalcon, debtFusdc, price)
      : null
  const collateralValueFusdc = price > 0 ? collateralFalcon * price : null
  return {
    healthFactor: hf,
    status: hfStatus(hf),
    liquidationDropPct: liquidationPriceDropPct(hf),
    collateralValueFusdc,
  }
}

export function collateralBlockedReason(
  principalFusdc: number | undefined,
  collateralFalcon: number | undefined,
  walletFalconBalance: number | null | undefined,
  falconPerFusdc: number | null | undefined,
): string | null {
  if (principalFusdc == null || !Number.isFinite(principalFusdc) || principalFusdc <= 0) {
    return null
  }
  if (falconPerFusdc == null || falconPerFusdc <= 0) {
    return 'AMM price unavailable — cannot validate FALCON collateral.'
  }
  const collateral = collateralFalcon ?? 0
  if (!Number.isFinite(collateral) || collateral <= 0) {
    return 'Enter how much FALCON you will post as collateral.'
  }
  const min = collateralFalconForDebt(principalFusdc, falconPerFusdc)
  if (min != null && collateral + 1e-9 < min) {
    return `Need at least ${min.toLocaleString(undefined, { maximumFractionDigits: 4 })} FALCON collateral (150% of borrow at current AMM price).`
  }
  if (walletFalconBalance != null && collateral > walletFalconBalance + 1e-9) {
    return `Insufficient FALCON in wallet (${walletFalconBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} available).`
  }
  const hf = healthFactor(collateral, principalFusdc, falconPerFusdc)
  if (hf != null && hf < LEND_LIQUIDATION_THRESHOLD) {
    return 'Collateral is too low — health factor would already be below the liquidation threshold (1.1).'
  }
  return null
}