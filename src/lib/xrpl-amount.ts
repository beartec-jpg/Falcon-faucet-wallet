export type XrpAmount = string
export type IouAmount = { currency: string; issuer: string; value: string }
/** XRPL MPT amount (integer units as string, e.g. satoshis for SPV FBTC). */
export type MptAmount = { mpt_issuance_id: string; value: string }
export type XrplAmount = XrpAmount | IouAmount | MptAmount

export type IouAsset = { currency: string; issuer: string }
export type MptAsset = { mpt_issuance_id: string }
export type XrplAsset = { currency: 'XRP' } | IouAsset | MptAsset

export function mptAsset(issuanceId: string): MptAsset {
  return { mpt_issuance_id: issuanceId.replace(/^0x/i, '').toUpperCase() }
}

export function mptAmount(issuanceId: string, units: number | string): MptAmount {
  const v =
    typeof units === 'number' && Number.isFinite(units)
      ? String(Math.round(units))
      : String(units).replace(/\..*$/, '')
  return { mpt_issuance_id: issuanceId.replace(/^0x/i, '').toUpperCase(), value: v }
}

/** BTC human units → integer sats string for SPV FBTC MPT. */
export function btcToSatsString(btc: number): string {
  if (!Number.isFinite(btc) || btc <= 0) return '0'
  return String(Math.round(btc * 1e8))
}

export function satsToBtc(sats: number): number {
  if (!Number.isFinite(sats)) return 0
  return sats / 1e8
}

export function isMptAmount(a: XrplAmount): a is MptAmount {
  return typeof a === 'object' && a !== null && 'mpt_issuance_id' in a
}
