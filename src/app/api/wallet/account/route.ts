import { NextRequest, NextResponse } from 'next/server'
import {
  resolveNetworkKey,
  serverNetworkConfig,
  serverRpcCall,
} from '@/lib/network-server'
import { fetchWalletAssets } from '@/lib/swap/wallet-assets'
import { parseAccountTxAmount } from '@/lib/tx-display'
import {
  resolveNamesForAddresses,
  resolveNameForAddress,
} from '@/lib/account-name-server'
import { plAccount, plStatus } from '@/lib/pl-rpc'
import { loadZeroPoint, offsetAsset, type ZeroPoint } from '@/lib/pl-zero-point'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/
const PL_NAME_RE = /^[A-Za-z0-9._-]{2,64}$/

function plAssets(
  raw: unknown,
  account: string,
  zp: ZeroPoint,
) {
  const map = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const sats = (key: string) => {
    const v = map[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return 0
  }
  const btc = offsetAsset(zp, account, 'BTC', sats('BTC'))
  const eth = offsetAsset(zp, account, 'ETH', sats('ETH'))
  const usdc = offsetAsset(zp, account, 'USDC', sats('USDC'))
  const bnb = offsetAsset(zp, account, 'BNB', sats('BNB'))
  const tokens: Array<Record<string, unknown>> = []
  if (btc) {
    tokens.push({
      symbol: 'FBTC',
      currency: 'BTC',
      issuer: '',
      balance: btc / 1e8,
      hasTrustLine: true,
      spvMpt: true,
      spvMptBalance: btc / 1e8,
    })
  }
  if (eth) {
    tokens.push({ symbol: 'FETH', currency: 'ETH', issuer: '', balance: eth / 1e18, hasTrustLine: true })
  }
  if (usdc) {
    tokens.push({ symbol: 'F-USDC', currency: 'USDC', issuer: '', balance: usdc / 1e6, hasTrustLine: true })
  }
  if (bnb) {
    tokens.push({ symbol: 'FBNB', currency: 'BNB', issuer: '', balance: bnb / 1e18, hasTrustLine: true })
  }
  return {
    fusdc: { symbol: 'F-USDC', balance: usdc / 1e6, currency: 'USDC', issuer: '', hasTrustLine: true },
    fbtc: {
      symbol: 'FBTC',
      balance: btc / 1e8,
      currency: 'BTC',
      issuer: '',
      hasTrustLine: true,
      sats: btc,
    },
    feth: { symbol: 'FETH', balance: eth / 1e18, currency: 'ETH', issuer: '', hasTrustLine: true },
    fbnb: { symbol: 'FBNB', balance: bnb / 1e18, currency: 'BNB', issuer: '', hasTrustLine: true },
    BTC: btc,
    ETH: eth,
    USDC: usdc,
    tokens,
    lp: { symbol: 'LP-TOKENS', balance: 0, currency: '', issuer: '', sharePct: 0, estXrpOut: 0, estUsdcOut: 0 },
  }
}

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

export interface TxRecord {
  hash:        string
  type:        string
  amount?:     string
  /** FPL | F-USDC | FETH | FBNB | … from parseTxAmount */
  amountAsset?: string
  destination?: string
  /** Human name for destination when known (AccountNames). */
  destinationName?: string | null
  account:     string
  /** Human name for sender when known. */
  accountName?: string | null
  result:      string
  date?:       number
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') ?? ''
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))

  const cfg = serverNetworkConfig(networkKey)
  const isPl = cfg.networkId === 2300
  if (isPl) {
    if (!ADDRESS_RE.test(address) && !PL_NAME_RE.test(address)) {
      return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
    }
  } else if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  try {
    if (isPl) {
      const [st, acct, zp] = await Promise.all([plStatus(false), plAccount(address), loadZeroPoint()])
      const exists = Boolean(acct.exists)
      return NextResponse.json({
        address,
        balance: num(acct.balance),
        sequence: num(acct.sequence),
        exists,
        transactions: [],
        currentLedger: num(st.tip_height),
        network: networkKey,
        accountType: String(acct.account_type ?? 'hot'),
        allowlist: Array.isArray(acct.allowlist) ? acct.allowlist : [],
        vaultLocked: Boolean(acct.vault_locked),
        assets: plAssets(acct.assets, address, zp),
      })
    }

    const [infoR, txR, srvR] = await Promise.all([
      serverRpcCall<{ error?: string; error_message?: string; account_data?: { Balance: string; Sequence: number } }>(
        networkKey, 'account_info', { account: address, ledger_index: 'validated' }, { allowError: true },
      ),
      serverRpcCall<{ error?: string; transactions?: unknown[] }>(
        networkKey, 'account_tx', { account: address, limit: 10, ledger_index_min: -1, ledger_index_max: -1 }, { allowError: true },
      ),
      serverRpcCall<{ info?: { validated_ledger?: { seq: number } } }>(networkKey, 'server_info', {}),
    ])

    const currentLedger: number = srvR?.info?.validated_ledger?.seq ?? 0

    if (infoR?.error === 'actNotFound') {
      return NextResponse.json({
        address,
        balance:        0,
        sequence:       0,
        exists:         false,
        transactions:   [],
        currentLedger,
        network:        networkKey,
        assets: await fetchWalletAssets(networkKey, address).catch(() => ({
          fusdc: { symbol: 'F-USDC', balance: 0, currency: 'QUC', issuer: '', hasTrustLine: false },
          lp: { symbol: 'LP-TOKENS', balance: 0, currency: '', issuer: '', sharePct: 0, estXrpOut: 0, estUsdcOut: 0 },
        })),
      })
    }

    if (infoR?.error) throw new Error(infoR.error_message ?? infoR.error)

    const balance:  number = parseInt(infoR.account_data!.Balance, 10) / 1_000_000
    const sequence: number = infoR.account_data!.Sequence

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawTxs: TxRecord[] = ((txR?.transactions ?? []) as any[])
      .map(t => {
        const tx = (t.tx ?? t.tx_json ?? {}) as Record<string, unknown>
        const meta = (t.meta ?? t.metaData ?? {}) as Record<string, unknown>
        const type = String(tx.TransactionType ?? 'Unknown')
        // Payments use Amount/DeliveredAmount; BTCDepositClaim / burn use meta BtcAmount / MPT
        const parsed = parseAccountTxAmount(type, tx, meta)
        return {
          hash:        String(t.hash ?? tx.hash ?? ''),
          type,
          amount:      parsed?.display,
          amountAsset: parsed?.asset,
          destination: tx.Destination as string | undefined,
          account:     String(tx.Account ?? ''),
          result:      String(meta.TransactionResult ?? (t.meta as { TransactionResult?: string } | undefined)?.TransactionResult ?? ''),
          date:        tx.date as number | undefined,
        }
      })
      .filter(t => t.hash)

    // Resolve AccountNames for counterparty display (send/receive lines).
    const addrs: string[] = []
    for (const t of rawTxs) {
      if (t.account) addrs.push(t.account)
      if (t.destination) addrs.push(t.destination)
    }
    // Include self so own name is always in the map (header + txs)
    addrs.push(address)
    const nameMap = await resolveNamesForAddresses(networkKey, addrs)
    let ownName: string | null = nameMap[address] ?? null
    let ownNameStatus: 'active' | 'releasing' | null = ownName ? 'active' : null
    // One full resolve for self (status + account_objects fallback if needed)
    if (!ownName) {
      const self = await resolveNameForAddress(networkKey, address)
      if (self.name) {
        ownName = self.name
        ownNameStatus = self.status ?? 'active'
        nameMap[address] = self.name
      }
    }

    const transactions: TxRecord[] = rawTxs.map((t) => ({
      ...t,
      accountName: t.account ? (nameMap[t.account] ?? null) : null,
      destinationName: t.destination ? (nameMap[t.destination] ?? null) : null,
    }))

    const assets = await fetchWalletAssets(networkKey, address)

    return NextResponse.json({
      address,
      balance,
      sequence,
      exists: true,
      transactions,
      currentLedger,
      network: networkKey,
      assets,
      names: nameMap,
      accountName: ownName,
      accountNameStatus: ownNameStatus,
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Node unavailable' },
      { status: 502 }
    )
  }
}