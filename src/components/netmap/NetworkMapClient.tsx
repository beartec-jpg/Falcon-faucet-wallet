'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useMemo, useRef, useState } from 'react'
import { NETWORK_MAP_CONFIG as CFG } from '@/config/network-map'
import { useNetworkFeed, type SealedBlock } from '@/hooks/useNetworkFeed'
import { layoutMap } from '@/lib/netmap-layout'
import { rateBetween, seatLag, type NetSample } from '@/lib/net-metrics'
import type { MetricPoint } from '@/lib/metric-history'
import TrendChart from '@/components/explorer/TrendChart'
import MetricModal, { seatOptions } from '@/components/explorer/MetricModal'
import { seatKey } from '@/lib/net-metrics'
import type { SeatView } from '@/components/netmap/NetworkScene'

const NetworkScene = dynamic(() => import('@/components/netmap/NetworkScene'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-sm">Loading 3D map…</div>,
})

const LIVE_WINDOW_MS = 5 * 60_000

function liveSeries(samples: NetSample[]) {
  const tps: MetricPoint[] = []
  const bpm: MetricPoint[] = []
  const mem: MetricPoint[] = []
  for (let i = 0; i < samples.length; i++) {
    mem.push({ t: samples[i].t, v: samples[i].mempool })
    if (i === 0) continue
    // Rate over ~6s (4 polls) so 1.5s polls against ~3s blocks are not all 0/spike.
    const r = rateBetween(samples[Math.max(0, i - 4)], samples[i])
    if (r) {
      tps.push({ t: samples[i].t, v: r.tps })
      bpm.push({ t: samples[i].t, v: r.blocks_min })
    }
  }
  return { tps, bpm, mem }
}

export default function NetworkMapClient() {
  const feed = useNetworkFeed(CFG.pollMs)
  const { data, live, blocks, event } = feed
  const [selected, setSelected] = useState<string | null>(null)
  const [modal, setModal] = useState<string | null>(null)
  const fpsRef = useRef<HTMLSpanElement | null>(null)

  const seatIdsKey = (data?.validators ?? []).map((v) => `${v.account}:${(data?.online_seats ?? []).includes(v.account) ? 1 : 0}`).join(',')
  const layout = useMemo(() => {
    const online = new Set(data?.online_seats ?? [])
    return layoutMap(
      CFG,
      (data?.validators ?? []).map((v) => ({ id: v.account, online: online.has(v.account) })),
    )
    // Re-layout only when the seat set / online flags change, not every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatIdsKey])

  const last = live.samples[live.samples.length - 1] ?? null
  const seats = useMemo(() => {
    const out: Record<string, SeatView> = {}
    if (!last) return out
    for (const s of last.seats) out[s.id] = { online: s.online, jailed: s.jailed, lag: seatLag(last.height, s) }
    // Seats in config but missing from status: offline.
    return out
  }, [last])

  const series = useMemo(() => liveSeries(live.samples), [live.samples, live.samples.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSelect = useCallback((id: string) => {
    setSelected(id)
    setModal(id)
  }, [])

  const sel = selected && last ? last.seats.find((s) => s.id === selected) : null
  const selPlace = selected ? (layout.seats.find((s) => s.id === selected) ?? (selected === layout.hub.id ? { host: layout.hub.host, locationLabel: 'hub' } : null)) : null
  const onlineN = data?.online_seats?.length ?? 0

  return (
    <div className="netmap-root fixed inset-0 bg-[#020617] text-[#E0DBCA] overflow-hidden" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif' }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="absolute inset-0 right-0 md:right-[340px] bottom-[86px]">
        {data && <NetworkScene layout={layout} seats={seats} event={event} maxBulges={CFG.maxBulges} selected={selected} onSelect={onSelect} fpsRef={fpsRef} />}
        {!data && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
            {feed.error ? `Status unavailable: ${feed.error}. Retrying…` : 'Connecting to Falcon PL status…'}
          </div>
        )}
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 md:right-[340px] flex items-center gap-4 px-4 py-3 pointer-events-none">
        <Link href="/scan" className="pointer-events-auto text-xs text-slate-400 hover:text-[#E0DBCA] border border-slate-800 rounded-lg px-2.5 py-1 bg-[#0F172A]/70">
          ← Explorer
        </Link>
        <h1 className="text-sm font-semibold tracking-wide">
          Falcon PL <span className="text-[#C07838]">live network</span>
        </h1>
        <span className="netmap-mono text-[11px] text-slate-500">
          #{data?.height?.toLocaleString() ?? '—'} · {onlineN} online · poll {CFG.pollMs / 1000}s
          {feed.lastPollMs != null ? ` (rtt ${feed.lastPollMs} ms)` : ''}
        </span>
        <span ref={fpsRef} className="netmap-mono text-[11px] text-slate-600 ml-auto" />
      </div>

      {/* Side panel */}
      <aside className="hidden md:flex flex-col gap-3 absolute top-0 right-0 bottom-0 w-[340px] bg-[#0F172A] border-l border-slate-800 p-4 overflow-y-auto">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Live · last 5 min</div>
        <Spark label="tx/s" value={live.rate60s?.tps} digits={1} series={series.tps} hint="60s avg" />
        <Spark label="blocks / min" value={live.rate60s?.blocks_min} digits={1} series={series.bpm} hint="60s avg" />
        <Spark label="mempool" value={data?.mempool} digits={0} series={series.mem} hint={`max ${data?.max_mempool?.toLocaleString() ?? '—'}`} />

        <div className="mt-1 rounded-xl border border-slate-800 p-3 text-xs space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Legend</div>
          <Legend c="#22C55E" t="Voting seat (online)" />
          <Legend c="#D4922A" t="Packer: flash + ring = block txs" />
          <Legend c="#475569" t="Jailed / offline" />
          <Legend c="#C07838" t={`Hub (${CFG.hub.seat} on ${CFG.hub.host}, config)`} />
          <Legend c="#D4922A" t="Bulges = sealed txs, 1 per 10" dot />
        </div>

        <div className="rounded-xl border border-slate-800 p-3 text-xs min-h-[120px]">
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">Node</div>
          {selected ? (
            <div className="space-y-1 netmap-mono">
              <div className="text-sm text-[#D4922A]">{selected}</div>
              <div className="text-slate-400">{[selPlace?.host, selPlace?.locationLabel].filter(Boolean).join(' · ') || '—'}</div>
              {sel && (
                <>
                  <div>status {sel.jailed ? 'jailed' : sel.online ? 'online' : 'offline'}</div>
                  <div>tip {sel.tip ? `#${sel.tip.toLocaleString()}` : 'not advertised'} · lag {seatLag(last!.height, sel) ?? '—'}</div>
                  <div>packs {sel.packs.toLocaleString()} · perf {sel.perf == null ? '—' : sel.perf.toFixed(3)}</div>
                </>
              )}
              <button type="button" onClick={() => setModal(selected)} className="mt-2 text-[#C07838] hover:text-[#D4922A]">
                Open 24h graphs →
              </button>
            </div>
          ) : (
            <div className="text-slate-500">Click a node for its details and 24h graphs.</div>
          )}
        </div>
        <p className="text-[10px] text-slate-600 leading-relaxed mt-auto">
          Every animation is triggered by a real change in <span className="netmap-mono">/api/scan</span> (polled every{' '}
          {CFG.pollMs / 1000}s). Nothing is interpolated between polls. Layout and locations live in{' '}
          <span className="netmap-mono">src/config/network-map.ts</span>.
        </p>
      </aside>

      {/* Block ticker */}
      <BlockTicker blocks={blocks} />

      {modal && (
        <MetricModal
          metric={seatKey(modal, 'lag')}
          options={seatOptions(modal, {
            tip: sel?.tip ? `#${sel.tip.toLocaleString()}` : 'not advertised',
            lag: sel && last ? String(seatLag(last.height, sel) ?? 'not advertised') : undefined,
            packs: sel ? `${sel.packs.toLocaleString()} total` : undefined,
            perf: sel?.perf == null ? undefined : sel.perf.toFixed(3),
          })}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function Spark({ label, value, digits, series, hint }: { label: string; value: number | null | undefined; digits: number; series: MetricPoint[]; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#020617]/50 px-3 pt-2 pb-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-slate-400">{label}</span>
        <span className="netmap-mono text-lg text-[#E0DBCA]">{value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits)}</span>
      </div>
      <TrendChart series={series} windowMs={LIVE_WINDOW_MS} compact height={44} gapMs={30_000} idSuffix={`-sp-${label}`} />
      {hint && <div className="text-[9px] text-slate-600 -mt-0.5 mb-0.5">{hint}</div>}
    </div>
  )
}

function Legend({ c, t, dot }: { c: string; t: string; dot?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-slate-300">
      <span className={dot ? 'w-1.5 h-1.5 rounded-full' : 'w-2.5 h-2.5 rounded-full'} style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
      {t}
    </div>
  )
}

function BlockTicker({ blocks }: { blocks: SealedBlock[] }) {
  return (
    <div className="absolute left-0 right-0 md:right-[340px] bottom-0 h-[86px] border-t border-slate-800 bg-[#0F172A]/95 flex items-center gap-2 px-3 overflow-hidden">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 w-14 shrink-0 leading-tight">sealed blocks</div>
      {blocks.length === 0 && <div className="text-xs text-slate-600">Waiting for the next block…</div>}
      {blocks.slice(0, 24).map((b, i) => (
        <div
          key={b.height}
          className={`netmap-block shrink-0 rounded-lg border px-2.5 py-1.5 netmap-mono ${i === 0 ? 'border-[#D4922A] netmap-block-new' : 'border-slate-700'}`}
        >
          <div className="text-[11px] text-[#D4922A]">#{b.height.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400">{b.packer ?? 'packer ?'}</div>
          <div className="text-[10px] text-slate-500">{b.txs == null ? '— tx' : `${b.txs} tx`}</div>
        </div>
      ))}
    </div>
  )
}

const CSS = `
.netmap-mono{font-family:var(--font-mono),'JetBrains Mono',monospace}
.netmap-label{font-family:var(--font-mono),'JetBrains Mono',monospace;text-align:center;white-space:nowrap;user-select:none}
.netmap-label-name{font-size:11px;color:#E0DBCA;text-shadow:0 0 6px #020617}
.netmap-label-sub{font-size:9px;color:#94A3B8;text-shadow:0 0 6px #020617}
.netmap-label[data-off] .netmap-label-name{color:#64748B}
.netmap-loc{font-family:var(--font-inter),Inter,sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#C07838;white-space:nowrap;user-select:none}
.netmap-todo{margin-left:6px;font-size:9px;letter-spacing:.05em;padding:1px 5px;border-radius:4px;border:1px dashed #D4922A;color:#D4922A}
@keyframes netmap-drop{0%{transform:translateY(-38px) scale(.9);opacity:0;box-shadow:0 0 0 #D4922A}40%{opacity:1;box-shadow:0 0 18px #D4922A}100%{transform:none;box-shadow:0 0 0 transparent}}
.netmap-block-new{animation:netmap-drop .7s ease-out}
.netmap-block{background:#020617;min-width:92px}
`
