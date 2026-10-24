'use client'

/**
 * /validator: run a Falcon PL 2300 node (one-line installer), requirements, live seats,
 * validator application status, Scott's admission queue, and how each node type is paid (rewards v2).
 * Read-only: no keys or signing on this page. The admission itself is Scott's on-chain ApproveValidator.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import { DISCORD_INVITE_URL } from '@/lib/community-links'
import { loadWallets } from '@/lib/wallet-store'
import {
  APPLICATIONS_REPO,
  FIRST_VALIDATOR_VERSION,
  ID_RE,
  INSTALL_CMD,
  RELEASES_REPO,
  type QueueRow,
  type ValidatorsResponse,
} from '@/lib/pl-validators'

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="shrink-0 rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300 hover:border-brand-400 hover:text-brand-300"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      {done ? 'Copied' : label}
    </button>
  )
}

function Cmd({ cmd }: { cmd: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-950/80 p-3">
      <code className="flex-1 break-all font-mono text-xs text-emerald-300">{cmd}</code>
      <Copy text={cmd} />
    </div>
  )
}

const STAGE_STYLE: Record<QueueRow['stage'], string> = {
  pending: 'text-amber-300',
  approved: 'text-cyan-300',
  'key-mismatch': 'text-red-400',
  bonded: 'text-brand-300',
  active: 'text-emerald-300',
  invalid: 'text-slate-500',
}

const PAY_ROWS: { who: string; share: string; how: string }[] = [
  {
    who: 'Validator · proposer',
    share: '50% of the validator pot + 30% of each block’s fees',
    how: 'Credits per block sealed in its own round: 64 + min(fee-paying txs, 64). Nothing for missed turns.',
  },
  {
    who: 'Validator · voter',
    share: '40% of the validator pot',
    how: '+1 per committed block whose certificate carries its timely vote.',
  },
  {
    who: 'Validator · floor',
    share: '10% of the validator pot',
    how: 'Equal per active seat; archive seats ×1.05. Inactive or jailed seats get nothing.',
  },
  {
    who: 'Watchers (heartbeat, BTC/ETH headers, auto-mint, prover receipts)',
    share: 'Watcher bucket, capped per account',
    how: 'Work × presence slots; every work credit marks the hourly slot.',
  },
  {
    who: 'Liquidity providers (AMM, lending)',
    share: 'LP buckets, capped per account',
    how: 'FPL value of the position held since the epoch start; lenders also earn borrow interest.',
  },
  {
    who: 'Observer node',
    share: '—',
    how: 'Not paid. It verifies the chain for you and serves your own wallet / ctl.',
  },
]

const UPGRADE_CMD = 'curl -fsSL https://falcon-fpl.com/install.sh | bash -s -- upgrade'

export default function ValidatorPage() {
  const [data, setData] = useState<ValidatorsResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [lookup, setLookup] = useState('')
  const [seatId, setSeatId] = useState('')
  const [payout, setPayout] = useState('')
  const [loaded, setLoaded] = useState<string[]>([])
  const [loadMsg, setLoadMsg] = useState('')
  const seat = seatId.trim().toLowerCase()
  const payoutName = payout.trim().toLowerCase()
  const seatOk = ID_RE.test(seat) && !/^(?:v\d+|faucet|treasury|community|builder|alice|bob|watcher-.*)$/.test(seat)
  const payoutOk = payoutName === '' || (/^[a-z][a-z0-9.]{2,31}$/.test(payoutName) && !payoutName.includes('..') && !payoutName.endsWith('.'))
  const validatorCmd = seatOk && payoutOk
    ? `curl -fsSL https://falcon-fpl.com/install.sh | bash -s -- --validator --id ${seat}${payoutName ? ` --payout '${payoutName}'` : ''}`
    : ''

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/pl2300/validators', { cache: 'no-store' })
      const j = (await r.json()) as ValidatorsResponse
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
      setErr(null)
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [load])

  const active = useMemo(() => (data?.seats ?? []).filter((s) => !s.jailed && s.bond > 0), [data])
  const lookupId = lookup.trim().toLowerCase()
  const lookupResult = useMemo(() => {
    if (!data || !lookupId) return null
    if (!ID_RE.test(lookupId)) return { stage: 'invalid id', detail: 'ids are 3–32 chars: a-z, 0-9, "-"' }
    const seat = data.seats.find((s) => s.id === lookupId)
    if (seat) {
      if (seat.jailed) return { stage: 'jailed', detail: `bond ${seat.bond.toLocaleString()} FPL, jail count ${seat.jailCount}` }
      if (seat.inactive) return { stage: 'inactive', detail: `missed ${seat.missedTurns ?? '?'} turns; the owner sends Reactivate after catching up` }
      return seat.lotteryReady
        ? { stage: 'active', detail: `bond ${seat.bond.toLocaleString()} FPL, ${seat.packCount.toLocaleString()} blocks packed` }
        : { stage: 'bonded, not ready', detail: 'the node must be synced and reachable by the seats' }
    }
    const ap = data.approvals.find((a) => a.id === lookupId)
    if (ap) return { stage: 'approved, waiting for bond', detail: `key ${ap.keyFingerprint}${ap.expiresHeight ? `, expires at height ${ap.expiresHeight.toLocaleString()}` : ''}` }
    const q = data.queue.find((x) => x.id === lookupId)
    if (q) return { stage: 'applied, waiting for approval', detail: `GitHub issue #${q.issue}` }
    return { stage: 'not found', detail: 'no seat, approval or open application with this id' }
  }, [data, lookupId])

  return (
    <ProductShell intensity={0.4}>
      <Header current="community" subtitle="Validators & nodes" />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            <Link href="/community" className="hover:text-brand-400">Community</Link>
            {' · '}Validators
          </p>
          <h1 className="text-2xl font-bold text-white">
            Run a <span className="text-cyan-400">Falcon PL node</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Public testnet 2300{data ? ` · ${data.product} · tip ${data.tip.toLocaleString()} · epoch ${data.epoch}` : ''}
            {data ? ` · ${active.filter((x) => x.online).length} online · ${active.length} bonded seats` : ''}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            New to this?{' '}
            <Link href="/community/validators/run-a-node" className="text-brand-400 hover:text-brand-300">
              Step-by-step guide →
            </Link>
          </p>
        </div>

        {data && !data.onboardingOpen && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <strong>Validator onboarding is not open yet.</strong> It opens after {FIRST_VALIDATOR_VERSION} activates and
            every seat has a public endpoint. New validators then need a validator key with proof of possession in
            the bond, Scott&apos;s admission approval, and a{' '}
            <strong>50,000 FPL</strong> minimum bond (existing seats are grandfathered). Until then you can run an
            observer node.
          </div>
        )}
        {err && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">Network status unavailable: {err}</div>}

        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white">Create an observer node</h2>
          <p className="text-sm text-slate-300">
            An observer follows the chain and checks it. It keeps the last 128 ledgers, serves your own wallet and <code className="text-slate-200">falcon-pl-ctl</code>, and does not bond or get paid.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-400">
            <li>Linux x86_64, about 2 GB RAM and 10 GB disk.</li>
            <li>Keys stay on that machine. The installer checks the release signature, installs a service, and peers through the public seeds.</li>
            <li>No seat id and no bond. Re-run any time. Manage it with <code className="text-slate-300">falcon-node status</code>, <code className="text-slate-300">logs</code>, <code className="text-slate-300">upgrade</code>, or <code className="text-slate-300">uninstall</code>.</li>
          </ul>
          <Cmd cmd={INSTALL_CMD} />
          <p className="text-xs text-slate-400">Upgrade an existing node to the latest release:</p>
          <Cmd cmd={UPGRADE_CMD} />
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white">Create a validator node</h2>
          <p className="text-sm text-slate-300">
            A validator does everything an observer does, then bonds 50,000 FPL and can seal blocks and vote. Rewards land on the seat account. An optional payout address receives that spendable balance after each epoch. The bond is not sent.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-400">
            <li>About 4–8 GB RAM, 20 GB disk, and online all the time.</li>
            <li>Enter a seat id. That name is the account on the chain. No contact field.</li>
            <li>After it syncs, Scott approves the seat and you fund the bond account. The installer bonds from that machine.</li>
          </ul>
          <label className="block max-w-sm text-xs text-slate-400">
            Seat id
            <input
              value={seatId}
              onChange={(e) => setSeatId(e.target.value)}
              placeholder="your-seat"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200"
            />
          </label>
          {seat && !seatOk && (
            <p className="text-xs text-amber-300">Seat id must start with a letter, be 3–32 characters (a–z, 0–9, hyphen), and not be a reserved name.</p>
          )}
          <label className="block max-w-sm text-xs text-slate-400">
            Auto payout address, optional
            <input
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              placeholder="leave blank to keep rewards on the node"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:border-brand-400 hover:text-brand-300"
              onClick={() => {
                void loadWallets().then((rows) => {
                  const names = [...new Set(rows.map((w) => (w.accountName || '').trim().toLowerCase()).filter(Boolean))]
                  setLoaded(names)
                  setLoadMsg(names.length === 0 ? 'No named wallet is loaded in this browser.' : '')
                  if (names.length === 1) setPayout(names[0])
                }).catch(() => setLoadMsg('Could not read wallets in this browser.'))
              }}
            >
              Use a loaded wallet
            </button>
            {loaded.map((name) => (
              <button
                key={name}
                type="button"
                className="rounded border border-brand-500/40 px-2 py-1 font-mono text-xs text-brand-300 hover:bg-brand-500/10"
                onClick={() => setPayout(name)}
              >
                {name}
              </button>
            ))}
          </div>
          {loadMsg && <p className="text-xs text-amber-300">{loadMsg}</p>}
          {payoutName && !payoutOk && (
            <p className="text-xs text-amber-300">Payout address must be 3–32 characters: a–z, 0–9, and dots.</p>
          )}
          {validatorCmd ? <Cmd cmd={validatorCmd} /> : <p className="text-xs text-slate-500">The install command appears here after the seat id is valid.</p>}
          <ol className="list-inside list-decimal space-y-1 text-xs text-slate-400">
            <li>Run that command. The node syncs first, then writes <code className="text-slate-300">application.json</code> on that machine. The file has the public key only.</li>
            <li>The installer prints a link. Open it and send the application. That is the only use of the application page.</li>
            <li>
              For activation, say the seat id in{' '}
              <a className="text-brand-400 hover:underline" href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">Discord</a>.
              Scott approves that id and key on the chain.
            </li>
            <li>Send 50,000 FPL plus fees to the bond account. The installer bonds from the node.</li>
            <li>The seat joins the lottery with the same odds as every other seat. If a payout address is set, each new epoch sends the seat&apos;s spendable FPL there. The bond stays on the node.</li>
          </ol>
          <p className="text-[11px] text-slate-500">
            Binaries and checksums:{' '}
            <a className="text-brand-400 hover:underline" href={`https://github.com/${RELEASES_REPO}/releases`} target="_blank" rel="noreferrer">
              github.com/{RELEASES_REPO}
            </a>
            . Applications:{' '}
            <a className="text-brand-400 hover:underline" href={`https://github.com/${APPLICATIONS_REPO}/issues`} target="_blank" rel="noreferrer">
              github.com/{APPLICATIONS_REPO}
            </a>
            .
          </p>
        </section>

        <section id="bridge-operator" className="card space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white">Run a bridge operator</h2>
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">Testnet · coming soon</span>
          </div>
          <p className="text-xs text-slate-300">
            Bridge operators keep FBTC withdrawals moving. This is a testnet4 preview: the operator installer is not published yet and the
            on-chain operator registry is not active, so you cannot join yet. The steps below show what setup will look like.
          </p>
          <h3 className="text-xs font-semibold text-white">What an operator does</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
            <li>Fronts BTC withdrawals: when a user burns FBTC, the operator pays them BTC from its own wallet.</li>
            <li>Is repaid from the locked deposits through the presigned peg-out graph.</li>
            <li>Watches the other operators&apos; claims against the Falcon ledger and challenges bad ones.</li>
            <li>Earns FPL for liveness, watching and payouts.</li>
          </ul>
          <h3 className="text-xs font-semibold text-white">Requirements</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
            <li>Linux x86_64, glibc 2.34+ (Ubuntu 22.04+, Debian 12+, RHEL 9+).</li>
            <li>A Bitcoin node (Bitcoin Core, synced, <code>txindex=1</code>) or Bitcoin RPC access.</li>
            <li>A BTC wallet you control with liquidity to front withdrawals (testnet4 coins for now) plus fees.</li>
            <li>A 5,000 FPL bond. Cheating is slashed 100%.</li>
            <li>Rewards: 5% of emissions, taken off the top, split across liveness, watching and payouts.</li>
          </ul>
          <h3 className="text-xs font-semibold text-white">Setup (preview)</h3>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-300">
            <li>Run the operator installer <code>install-operator.sh</code> (not published yet; it will verify a signed release and install to <code>~/.falcon-operator</code>).</li>
            <li>Create and fund a BTC wallet in your own bitcoind, e.g. <code>bitcoin-cli -testnet4 createwallet fpl-operator</code>.</li>
            <li>Edit <code>~/.falcon-operator/operator.env</code>: your Falcon account for FPL rewards, Falcon RPC, bitcoind args, wallet name, payout/reserve limits.</li>
            <li>Run <code>falcon-operator check</code> and confirm every item shows <code>ok</code>.</li>
            <li>Get your public key with <code>fpl-operatord pubkey</code> and list the other operators in <code>~/.falcon-operator/peers.json</code> as <code>{'[{"name", "xonly", "url"}]'}</code> (until the on-chain registry is live).</li>
            <li>Start the daemon <code>fpl-operatord</code> (it starts in dry-run mode).</li>
            <li>Check it is healthy: <code>curl 127.0.0.1:19480/health</code> returns 200 when both the Falcon node and your bitcoind wallet are reachable; <code>/status</code> shows what it would front.</li>
          </ol>
          <p className="text-[11px] text-slate-500">Testnet preview only. Mainnet operation is possible only once the bridge activates.</p>
        </section>

        <section className="card space-y-2 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white">Requirements</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-slate-500">
                <tr><th className="py-1 pr-3">Role</th><th className="pr-3">CPU</th><th className="pr-3">RAM</th><th className="pr-3">Disk</th><th>Network</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-slate-800"><td className="py-1 pr-3">Observer</td><td className="pr-3">1–2 vCPU x86_64</td><td className="pr-3">2 GB</td><td className="pr-3">10 GB</td><td>outbound TCP to the seed only</td></tr>
                <tr className="border-t border-slate-800"><td className="py-1 pr-3">Validator</td><td className="pr-3">2+ vCPU (SHA-NI helps)</td><td className="pr-3">4–8 GB</td><td className="pr-3">20 GB</td><td>outbound TCP to every seat; online 24/7</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">Ubuntu 20.04+ / Debian 11+ (glibc ≥ 2.31). AVX-512 is not needed. A validator that misses 20 turns in a row goes inactive (no slash) until it sends Reactivate.</p>
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white">Look up a seat</h2>
          <p className="text-xs text-slate-400">Type a seat id to see whether it is waiting for approval, approved, bonded, or not on the chain. This does not install anything.</p>
          <input
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            placeholder="Seat id"
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-200"
          />
          {lookupResult && (
            <p className="text-sm text-slate-300">
              <span className="font-semibold text-white">{lookupResult.stage}</span>
              <span className="text-slate-500"> · {lookupResult.detail}</span>
            </p>
          )}
        </section>

        <section className="card overflow-x-auto p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white">Seats</h2>
          {!data ? (
            <p className="text-xs text-slate-500">Loading…</p>
          ) : (
            <table className="w-full text-left font-mono text-xs text-slate-300">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3">id</th><th className="pr-3">bond</th>{data.seats.some((s) => s.escrow != null) && <th className="pr-3">escrow</th>}
                  <th className="pr-3">state</th><th className="pr-3">packed</th><th className="pr-3">bond account</th>{data.seats.some((s) => s.keyFingerprint) && <th>key</th>}
                </tr>
              </thead>
              <tbody>
                {data.seats.filter((s) => !s.jailed).map((s) => {
                  const state = s.jailed ? 'jailed' : s.inactive ? 'inactive' : s.lotteryReady ? 'active' : 'bonded'
                  const cls = s.jailed ? 'text-red-400' : s.inactive ? 'text-amber-300' : s.lotteryReady ? 'text-emerald-300' : 'text-slate-400'
                  return (
                    <tr key={s.id} className="border-t border-slate-800">
                      <td className="py-1 pr-3 text-white">{s.id}{s.archive ? ' (archive)' : ''}</td>
                      <td className="pr-3">{s.bond.toLocaleString()}</td>
                      {data.seats.some((x) => x.escrow != null) && <td className="pr-3">{(s.escrow ?? 0).toLocaleString()}</td>}
                      <td className={`pr-3 ${cls}`}>{state}</td>
                      <td className="pr-3">{s.packCount.toLocaleString()}</td>
                      <td className="pr-3 text-slate-500">{s.bondAccount}</td>
                      {data.seats.some((x) => x.keyFingerprint) && <td className="text-slate-500">{s.keyFingerprint ?? '—'}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {data && (
            <p className="mt-2 text-[11px] text-slate-500">
              Committee {data.committeeSize} per height, quorum 4. Reward formula: {data.rewardFormula}. Lottery odds have been equal for every eligible seat since {FIRST_VALIDATOR_VERSION} (current: {data.product}); the bond buys eligibility, not odds.
            </p>
          )}
        </section>

        <section className="card overflow-x-auto p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white">Admission queue</h2>
            <a className="text-[11px] text-brand-400 hover:underline" href={`https://github.com/${APPLICATIONS_REPO}/issues?q=is%3Aissue+is%3Aopen+label%3Aapplication`} target="_blank" rel="noreferrer">
              open applications on GitHub →
            </a>
          </div>
          {data?.queueError && <p className="text-xs text-slate-500">{data.queueError}</p>}
          {data && !data.queueError && data.queue.length === 0 && <p className="text-xs text-slate-500">No open applications.</p>}
          {data && data.queue.length > 0 && (
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-slate-500">
                <tr><th className="py-1 pr-3">id</th><th className="pr-3">stage</th><th className="pr-3">key</th><th className="pr-3">bond account</th><th className="pr-3">contact</th><th>approve (Scott, admission key)</th></tr>
              </thead>
              <tbody>
                {data.queue.map((q) => {
                  const cmd = q.publicKey ? `falcon-pl-ctl --addr <seat> approve-validator --id ${q.id} --pubkey ${q.publicKey} --expires +20000 --keys-dir keys/admission --network-id 2300` : ''
                  return (
                    <tr key={q.issue} className="border-t border-slate-800 align-top">
                      <td className="py-1 pr-3 font-mono text-white"><a href={q.url} target="_blank" rel="noreferrer" className="hover:underline">{q.id || '?'}</a> <span className="text-slate-500">#{q.issue}</span></td>
                      <td className={`pr-3 ${STAGE_STYLE[q.stage]}`}>{q.stage}{q.note ? <div className="text-[10px] text-slate-500">{q.note}</div> : null}</td>
                      <td className="pr-3 font-mono text-slate-500">{q.fingerprint || '—'}</td>
                      <td className="pr-3 font-mono">{q.bondAccount || '—'}</td>
                      <td className="pr-3">{q.contact || '—'}</td>
                      <td>{q.stage === 'pending' && cmd ? <Copy text={cmd} label="Copy approve command" /> : <span className="text-slate-600">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            Approval is an on-chain <code>ApproveValidator</code> signed by Scott&apos;s admission key (introduced in {FIRST_VALIDATOR_VERSION}). This page never signs anything.
          </p>
        </section>

        <section className="card overflow-x-auto p-5">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-white">Who gets paid (rewards v2)</h2>
          <p className="mb-3 text-xs text-slate-400">
            Each 7-day epoch emits 0.30% of the treasury. The v2 rules below start with <strong>epoch 10</strong> (Sat 17 Oct ~22:45 BST; first v2 settle Sat 24 Oct).
            Fees: 50% burned, 30% to the block&apos;s proposer at commit, 20% to the epoch pot. Unjail payments are held as escrow, returned on a clean exit.
          </p>
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="text-slate-500"><tr><th className="py-1 pr-3">Node</th><th className="pr-3">Share</th><th>How it is earned</th></tr></thead>
            <tbody>
              {PAY_ROWS.map((r) => (
                <tr key={r.who} className="border-t border-slate-800 align-top"><td className="py-1 pr-3 text-white">{r.who}</td><td className="pr-3">{r.share}</td><td className="text-slate-400">{r.how}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-500">
            Live per-account numbers: <Link href="/airdrop?tab=claim" className="text-brand-400 hover:underline">Rewards</Link>. Explorer: <Link href="/scan" className="text-brand-400 hover:underline">Scan</Link>.
          </p>
        </section>

        <p className="pb-8 text-center text-xs text-slate-600">
          <Link href="/community" className="hover:text-slate-400">← Back to Community</Link>
        </p>
      </main>
    </ProductShell>
  )
}
