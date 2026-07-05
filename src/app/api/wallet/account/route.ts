import { NextRequest, NextResponse } from 'next/server'
import {
  resolveNetworkKey,
  serverRpcCall,
} from '@/lib/network-server'
import { fetchWalletAssets } from '@/lib/swap/wallet-assets'
import { parseTxAmount } from '@/lib/tx-display'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

export interface TxRecord {
  hash:        string
  type:        string
  amount?:     string
  amountAsset?: 'FALCON' | 'F-USDC'
  destination?: string
  account:     string
  result:      string
  date?:       number
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') ?? ''
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))

  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  try {
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
    const transactions: TxRecord[] = ((txR?.transactions ?? []) as any[])
      .map(t => {
        const tx = t.tx ?? t.tx_json ?? {}
        const parsed = parseTxAmount(tx.Amount)
        return {
          hash:        (t.hash ?? tx.hash) as string,
          type:        (tx.TransactionType ?? 'Unknown') as string,
          amount:      parsed?.display,
          amountAsset: parsed?.asset,
          destination: tx.Destination as string | undefined,
          account:     (tx.Account ?? '') as string,
          result:      (t.meta?.TransactionResult ?? '') as string,
          date:        tx.date as number | undefined,
        }
      })
      .filter(t => t.hash)

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
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Node unavailable' },
      { status: 502 }
    )
  }
}