import { NextRequest, NextResponse } from 'next/server'

const RPC = process.env.XRPLD_RPC_URL ?? 'http://127.0.0.1:6005'

// Minimal address validation — r + 25-34 base58 chars
const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(RPC, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ method, params: [params] }),
    cache:   'no-store',
  })
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`)
  return (await res.json()).result
}

export interface TxRecord {
  hash:        string
  type:        string
  amount?:     string
  destination?: string
  account:     string
  result:      string
  date?:       number
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') ?? ''

  if (!ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }

  try {
    const [infoR, txR, srvR] = await Promise.all([
      rpc('account_info', { account: address, ledger_index: 'validated' }),
      rpc('account_tx',   { account: address, limit: 10, ledger_index_min: -1, ledger_index_max: -1 }),
      rpc('server_info',  {}),
    ])

    const currentLedger: number = srvR?.info?.validated_ledger?.seq ?? 0

    // Account not found → return zeroed data (new/unfunded account)
    if (infoR?.error === 'actNotFound') {
      return NextResponse.json({
        address,
        balance:        0,
        sequence:       0,
        exists:         false,
        transactions:   [],
        currentLedger,
      })
    }

    if (infoR?.error) throw new Error(infoR.error_message ?? infoR.error)

    const balance:  number = parseInt(infoR.account_data.Balance, 10) / 1_000_000
    const sequence: number = infoR.account_data.Sequence as number

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transactions: TxRecord[] = ((txR?.transactions ?? []) as any[])
      .map(t => {
        const tx = t.tx ?? t.tx_json ?? {}
        return {
          hash:        (t.hash ?? tx.hash) as string,
          type:        (tx.TransactionType ?? 'Unknown') as string,
          amount:      tx.Amount as string | undefined,
          destination: tx.Destination as string | undefined,
          account:     (tx.Account ?? '') as string,
          result:      (t.meta?.TransactionResult ?? '') as string,
          date:        tx.date as number | undefined,
        }
      })
      .filter(t => t.hash)

    return NextResponse.json({
      address,
      balance,
      sequence,
      exists: true,
      transactions,
      currentLedger,
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Node unavailable' },
      { status: 502 }
    )
  }
}
