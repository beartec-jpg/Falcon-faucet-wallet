'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useNetwork } from '@/components/NetworkProvider'
import { withNetworkQuery } from '@/lib/network-query'
import type { LendOverview } from '@/lib/lend-model'

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: d })
}

export default function WalletLendSummary({ address }: { address: string }) {
  const { networkKey } = useNetwork()
  const [data, setData] = useState<LendOverview | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(withNetworkQuery(`/api/lend/overview?address=${encodeURIComponent(address)}`, networkKey))
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setData(j as LendOverview) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [address, networkKey])

  const e = data?.epoch

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-400">Lend · PoPL</span>
        <Link href="/lend" className="text-xs text-brand-400 hover:text-brand-300">
          Open Lend →
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div>
          <div className="text-slate-600">Epoch</div>
          <div className="font-mono text-slate-300">{e?.number ?? '—'}</div>
        </div>
        <div>
          <div className="text-slate-600">CID target</div>
          <div className="font-mono text-brand-400/90">{e?.cidEmissionPct != null ? `${fmt(e.cidEmissionPct)}%` : '—'}</div>
        </div>
        <div>
          <div className="text-slate-600">LP share</div>
          <div className="font-mono text-brand-400/90">{e?.lpAllocationPct != null ? `${fmt(e.lpAllocationPct)}%` : '—'}</div>
        </div>
      </div>
      {!data?.protocol.lendingReady && (
        <p className="text-[10px] text-slate-600">Supply/borrow live after genesis restart.</p>
      )}
    </div>
  )
}