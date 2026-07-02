import { NextRequest, NextResponse } from 'next/server'
import { resolveNetworkKey, serverRpcCall } from '@/lib/network-server'

const ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/

const BOND_STATUS: Record<number, string> = {
  0: 'none',
  1: 'registered',
  2: 'bonded',
  3: 'unbonding',
  4: 'slashed',
}

const DROPS_PER_QXRP = 1_000_000

function dropsToQxrp(drops: string | number | undefined | null): number | null {
  if (drops == null || drops === '') return null
  const n = typeof drops === 'string' ? parseInt(drops, 10) : drops
  if (!Number.isFinite(n)) return null
  return n / DROPS_PER_QXRP
}

export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get('account')?.trim() ?? ''
  const networkKey = resolveNetworkKey(req.nextUrl.searchParams.get('network'))

  if (!ADDRESS_RE.test(account)) {
    return NextResponse.json({ error: 'Invalid account' }, { status: 400 })
  }

  try {
    const [bondR, acctR, epochR] = await Promise.all([
      serverRpcCall<{ node?: Record<string, unknown> }>(
        networkKey,
        'ledger_entry',
        { validator_bond: { account }, ledger_index: 'validated' },
        { allowError: true },
      ),
      serverRpcCall<{ account_data?: { Balance: string; Sequence: number } }>(
        networkKey,
        'account_info',
        { account, ledger_index: 'validated' },
        { allowError: true },
      ),
      serverRpcCall<{ node?: Record<string, unknown> }>(
        networkKey,
        'ledger_entry',
        { reward_epoch: true, ledger_index: 'validated' },
        { allowError: true },
      ),
    ])

    const bond = bondR?.node
    const epoch = epochR?.node
    const acct = acctR?.account_data

    if (!bond) {
      return NextResponse.json({
        account,
        registered: false,
        balance_qxrp: dropsToQxrp(acct?.Balance),
        sequence: acct?.Sequence ?? null,
      })
    }

    const statusCode = bond.BondStatus as number | undefined
    const compositeScore = bond.CompositeScore as number | undefined

    return NextResponse.json({
      account,
      registered: true,
      bond_status: BOND_STATUS[statusCode ?? 0] ?? `status_${statusCode}`,
      bonded_amount_qxrp: dropsToQxrp(bond.BondedAmount as string),
      composite_score: compositeScore ?? null,
      reward_accum_qxrp: dropsToQxrp(bond.RewardAccumulator as string),
      uptime_score: bond.UptimeScore ?? null,
      vote_accuracy_score: bond.VoteAccuracyScore ?? null,
      slash_multiplier: bond.SlashMultiplier ?? null,
      last_claimed_epoch: bond.LastClaimedEpoch ?? null,
      can_claim:
        statusCode === 2 &&
        (compositeScore ?? 0) >= 500 &&
        parseInt(String(bond.RewardAccumulator ?? '0'), 10) > 0,
      balance_qxrp: dropsToQxrp(acct?.Balance),
      sequence: acct?.Sequence ?? null,
      epoch: epoch
        ? {
            number: epoch.EpochNumber,
            pool_balance_qxrp: dropsToQxrp(epoch.EpochPoolBalance as string),
            emission_rate_qxrp: dropsToQxrp(epoch.EmissionRate as string),
          }
        : null,
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Node unavailable' },
      { status: 502 },
    )
  }
}