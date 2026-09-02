const DROPS_PER_FALCON = 1_000_000

/** Display label for native or issued amounts in tx history. */
export type TxDisplayAsset = string

export interface ParsedTxAmount {
  display: string
  asset: TxDisplayAsset
  /** XRPL currency code when IOU (QUC, ETH, BNB, …) */
  currency?: string
  issuer?: string
}

/** Map Falcon IOU currency codes → product symbols. */
export function currencyToDisplayAsset(currency: string | undefined): string {
  if (!currency) return 'IOU'
  const c = currency.toUpperCase()
  switch (c) {
    case 'QUC':
    case 'USD':
    case 'USDC':
      return 'F-USDC'
    case 'ETH':
      return 'FETH'
    case 'BNB':
      return 'FBNB'
    case 'BTC':
    case 'XBT':
      return 'FBTC'
    case 'QUT':
    case 'USDT':
      return 'F-USDT'
    default:
      // 3-char classic currency or hex 40-char — show readable code
      if (/^[A-Z0-9]{3}$/.test(c)) return c
      if (c.length >= 8) return `${c.slice(0, 4)}…`
      return c
  }
}

/** Parse XRPL Payment Amount (drops string or IOU object) for UI display. */
export function parseTxAmount(amount: unknown): ParsedTxAmount | null {
  if (amount == null) return null

  if (typeof amount === 'string') {
    const drops = parseInt(amount, 10)
    if (!Number.isFinite(drops)) return null
    return {
      display: (drops / DROPS_PER_FALCON).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 6,
      }),
      asset: 'FPL',
    }
  }

  if (typeof amount === 'object' && amount !== null && 'value' in amount) {
    const iou = amount as { value: unknown; currency?: string; issuer?: string }
    const value = String(iou.value)
    const n = parseFloat(value)
    if (!Number.isFinite(n)) return null
    const currency = iou.currency ? String(iou.currency) : undefined
    const issuer = iou.issuer ? String(iou.issuer) : undefined
    return {
      display: n.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 8,
      }),
      asset: currencyToDisplayAsset(currency),
      currency,
      issuer,
    }
  }

  return null
}

/**
 * Parse satoshi-style amounts from Falcon BTC bridge fields.
 * Engine often returns hex strings (e.g. "c350" = 50000 sats).
 */
export function parseSatsAmount(raw: unknown): number | null {
  if (raw == null) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  const s = String(raw).trim()
  if (!s) return null
  // Prefer hex when pure hex and not only digits that look decimal-safe with 0x
  if (/^0x[0-9a-f]+$/i.test(s)) {
    const n = parseInt(s.slice(2), 16)
    return Number.isFinite(n) ? n : null
  }
  // Falcon binary JSON often drops 0x — short hex like "c350", "61a8"
  if (/^[0-9a-f]+$/i.test(s) && /[a-f]/i.test(s)) {
    const n = parseInt(s, 16)
    return Number.isFinite(n) ? n : null
  }
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function formatSatsAsBtc(sats: number): string {
  const btc = sats / 100_000_000
  return btc.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  })
}

type MetaNode = {
  CreatedNode?: {
    LedgerEntryType?: string
    NewFields?: Record<string, unknown>
  }
  ModifiedNode?: {
    LedgerEntryType?: string
    FinalFields?: Record<string, unknown>
    PreviousFields?: Record<string, unknown>
  }
  DeletedNode?: {
    LedgerEntryType?: string
    FinalFields?: Record<string, unknown>
  }
}

/**
 * BTCDepositClaim / BTCBridgeBurn have no Payment Amount field.
 * Pull amount from meta (BtcDeposit.BtcAmount, MPT delta) or burn fields.
 */
export function parseBridgeTxAmount(
  txType: string,
  tx: Record<string, unknown>,
  meta: Record<string, unknown> | null | undefined,
): ParsedTxAmount | null {
  const type = txType || ''

  if (type === 'BTCBridgeBurn' || type === 'BTCWithdrawFinalize') {
    const fromTx = parseSatsAmount(tx.BtcWithdrawAmount)
    if (fromTx != null && fromTx > 0) {
      return { display: formatSatsAsBtc(fromTx), asset: 'FBTC', currency: 'BTC' }
    }
  }

  const nodes = (meta?.AffectedNodes as MetaNode[] | undefined) ?? []
  for (const n of nodes) {
    const created = n.CreatedNode
    if (created?.LedgerEntryType === 'BtcDeposit') {
      const sats = parseSatsAmount(created.NewFields?.BtcAmount)
      if (sats != null && sats > 0) {
        return { display: formatSatsAsBtc(sats), asset: 'FBTC', currency: 'BTC' }
      }
    }
    if (created?.LedgerEntryType === 'BtcWithdrawal') {
      const sats = parseSatsAmount(created.NewFields?.BtcWithdrawAmount)
      if (sats != null && sats > 0) {
        return { display: formatSatsAsBtc(sats), asset: 'FBTC', currency: 'BTC' }
      }
    }
  }

  // MPT delta for the account (claim mint / burn burn)
  for (const n of nodes) {
    const created = n.CreatedNode
    if (created?.LedgerEntryType === 'MPToken') {
      const sats = parseSatsAmount(created.NewFields?.MPTAmount)
      if (sats != null && sats > 0) {
        return { display: formatSatsAsBtc(sats), asset: 'FBTC', currency: 'BTC' }
      }
    }
    const mod = n.ModifiedNode
    if (mod?.LedgerEntryType === 'MPToken') {
      const fin = parseSatsAmount(mod.FinalFields?.MPTAmount)
      const prev = parseSatsAmount(mod.PreviousFields?.MPTAmount)
      if (fin != null && prev != null) {
        const delta = Math.abs(fin - prev)
        if (delta > 0) {
          return { display: formatSatsAsBtc(delta), asset: 'FBTC', currency: 'BTC' }
        }
      }
      // PreviousFields may omit MPTAmount when going from 0 → n on some builds
      if (fin != null && fin > 0 && prev == null && type === 'BTCDepositClaim') {
        // Prefer BtcDeposit amount above; skip ambiguous full balance
      }
    }
  }

  return null
}

/**
 * Best-effort amount for wallet activity: Payment first, then bridge meta.
 */
export function parseAccountTxAmount(
  txType: string,
  tx: Record<string, unknown>,
  meta: Record<string, unknown> | null | undefined,
): ParsedTxAmount | null {
  const amountField =
    meta?.delivered_amount ??
    meta?.DeliveredAmount ??
    tx.DeliverMax ??
    tx.Amount
  const fromPayment = parseTxAmount(amountField)
  if (fromPayment) return fromPayment
  return parseBridgeTxAmount(txType, tx, meta)
}
