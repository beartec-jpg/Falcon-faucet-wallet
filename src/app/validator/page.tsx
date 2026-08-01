'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import ProductShell from '@/components/ProductShell'
import { loadPrimaryWallet } from '@/lib/wallet-store'

const NETWORK_NAME = process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'Falcon Ledger Testnet'
const DRIP_AMOUNT  = parseInt(process.env.NEXT_PUBLIC_DRIP_AMOUNT_QXRP ?? '2000', 10)
const PUBLIC_RPC   = process.env.NEXT_PUBLIC_RPC_URL ?? 'http://46.224.0.140:6005'
const PORTAL_URL   = 'https://falcon-ledger.com'
const PLACEHOLDER_PAYOUT = 'rYourWalletAddress'
const DEFAULT_NODE_NAME = 'my-falcon-node'

interface CommandRow {
  label: string
  cmd: string
  note?: string
}

const SERVER_COMMANDS: CommandRow[] = [
  { label: 'Dashboard URL', cmd: 'http://<your-server-ip>:8080', note: 'Browser only — IP alone is not enough; use port 8080. Open TCP 8080 in cloud firewall.' },
  { label: 'Dashboard health', cmd: 'curl -s http://127.0.0.1:8080/health' },
  { label: 'Bond log', cmd: 'tail -f /var/lib/falcon-validator/bond.log' },
  { label: 'Live logs', cmd: 'docker logs -f falcon-validator' },
  { label: 'Restart', cmd: 'cd /var/lib/falcon-validator && docker compose restart' },
  { label: 'Stop', cmd: 'cd /var/lib/falcon-validator && docker compose down' },
  { label: 'Node info', cmd: "curl -s -X POST http://127.0.0.1:5005 -H 'Content-Type: application/json' -d '{\"method\":\"server_info\",\"params\":[{}]}' | python3 -m json.tool" },
  { label: 'Validator balance', cmd: `curl -s -X POST ${PUBLIC_RPC} -H 'Content-Type: application/json' -d '{"method":"account_info","params":[{"account":"<validator-r-address>","ledger_index":"validated"}]}'` },
]

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setOk(true)
        setTimeout(() => setOk(false), 2000)
      }}
      className="text-[10px] text-cyan-500 hover:text-cyan-300 flex-shrink-0"
    >
      {ok ? '✓' : 'copy'}
    </button>
  )
}

// Pin install script to a known-good commit so raw.githubusercontent CDN
// cannot serve a stale develop blob mid-install (was aborting after smoke).
const INSTALL_SCRIPT_COMMIT = '473894d3ae29b961be8c2dfef000372d90ba6564'
const INSTALL_SCRIPT_URL =
  `https://raw.githubusercontent.com/beartec-jpg/FalconLedger/${INSTALL_SCRIPT_COMMIT}/bin/install/install-qxrp-validator.sh`

function buildOneLiner(payout: string, nodeName: string) {
  // Live Falcon testnet 1001 SPV fleet — always pin btc-spv-v6 (never :latest).
  return `export QXRP_XRPLD_IMAGE=qxrp/xrpld:btc-spv-v6
curl -fsSL ${INSTALL_SCRIPT_URL} | bash -s -- \\
  --payout ${payout} \\
  --node-name ${nodeName}`
}

export default function ValidatorGuidePage() {
  const [payoutAddress, setPayoutAddress] = useState<string | null>(null)
  const [walletLoading, setWalletLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const w = await loadPrimaryWallet()
        if (!cancelled) setPayoutAddress(w?.address?.trim() || null)
      } catch {
        if (!cancelled) setPayoutAddress(null)
      } finally {
        if (!cancelled) setWalletLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const payout = payoutAddress || PLACEHOLDER_PAYOUT
  const hasWallet = !!payoutAddress
  const oneLiner = useMemo(
    () => buildOneLiner(payout, DEFAULT_NODE_NAME),
    [payout],
  )

  const steps = [
    { n: 1, title: 'Create a Falcon wallet', body: 'Open Wallet and create a passkey-secured wallet. Back up your falcon_secret.' },
    { n: 2, title: `Claim ${DRIP_AMOUNT.toLocaleString()} FALCON from the faucet`, body: 'Use Faucet (or Falcon wallet → Top up). One drip per day per IP/account is enough to fund bonding.' },
    {
      n: 3,
      title: 'Copy the one-liner',
      body: hasWallet
        ? `Copy the install command below — --payout is already set to your wallet (${payoutAddress}).`
        : 'Copy the install command below. Open Wallet first so --payout fills in automatically.',
    },
    { n: 4, title: 'Run on Ubuntu 22.04/24.04', body: 'Paste into a VPS or spare PC with port 51235/TCP open (and outbound internet). Docker installs automatically. Image: qxrp/xrpld:btc-spv-v6 (Bitcoin SPV bridge).' },
    { n: 5, title: 'Fund the validator address', body: 'The installer prints a NEW validator r-address. Send ≥1,100 FALCON there (from your wallet or another drip tomorrow).' },
    { n: 6, title: 'Auto-bond + rewards', body: 'Installer polls until funded, submits ValidatorRegister + Bond(1000), and sets up hourly ClaimReward cron. Claim extras from Community → Rewards.' },
  ]

  return (
    <ProductShell intensity={0.4}>
      <Header current="community" subtitle="Validator guide" />

      <main className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full space-y-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-500 mb-2">
            <Link href="/community" className="hover:text-brand-400">Community</Link>
            {' · '}Validators
          </p>
          <h1 className="text-2xl font-bold text-white">Run a <span className="text-cyan-400">Validator</span></h1>
          <p className="text-sm text-slate-400 mt-1">
            {NETWORK_NAME} · Network ID 1001 · Bond 1,000 FALCON · Faucet drip {DRIP_AMOUNT.toLocaleString()} FALCON
          </p>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          The network has <strong>4 bonded validators</strong> live. You can add a fifth (or run a non-validating full node) using the flow below.
        </div>

        {/* Steps */}
        <section className="card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Step-by-step</h2>
          <ol className="space-y-3">
            {steps.map(s => (
              <li key={s.n} className="flex gap-3 text-sm">
                <span className="text-cyan-600 font-mono text-xs w-6 flex-shrink-0 pt-0.5">{String(s.n).padStart(2, '0')}</span>
                <div>
                  <div className="font-medium text-slate-200">{s.title}</div>
                  <div className="text-slate-500 text-xs mt-0.5">{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link href="/wallet" className="text-sm text-brand-400 hover:text-brand-300">
              Open Wallet →
            </Link>
            <Link href="/faucet" className="text-sm text-brand-400 hover:text-brand-300">
              Open Faucet →
            </Link>
            <Link href="/rewards" className="text-sm text-brand-400 hover:text-brand-300">
              Claim rewards →
            </Link>
          </div>
        </section>

        {/* One-liner template */}
        <section className="card p-5 space-y-2">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">One-liner template</h2>
          {walletLoading ? (
            <p className="text-xs text-slate-500">Loading wallet…</p>
          ) : hasWallet ? (
            <p className="text-xs text-emerald-400/90">
              <span className="text-slate-500">Payout wallet auto-filled:</span>{' '}
              <code className="text-emerald-300 font-mono break-all">{payoutAddress}</code>
            </p>
          ) : (
            <p className="text-xs text-amber-300/90">
              No wallet on this device yet —{' '}
              <Link href="/wallet" className="text-brand-400 hover:underline">
                open Wallet
              </Link>{' '}
              to create one. The command will insert your address as{' '}
              <code className="text-slate-400">--payout</code> automatically.
            </p>
          )}
          <div className="relative">
            <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] text-emerald-300 font-mono whitespace-pre-wrap break-all pr-12">{oneLiner}</pre>
            <div className="absolute top-2 right-2"><CopyBtn text={oneLiner} /></div>
          </div>
          {hasWallet && (
            <p className="text-[10px] text-slate-600">
              Copy &amp; paste as-is on your server. Optional: change{' '}
              <code className="text-slate-500">--node-name</code> (e.g. falcon2).
            </p>
          )}
        </section>

        {/* Requirements */}
        <section className="card p-5 space-y-2">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Requirements</h2>
          <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
            <li>Ubuntu 22.04 or 24.04 (or Debian 12)</li>
            <li>≥4 GB RAM, ≥40 GB disk</li>
            <li>Port <strong className="text-amber-300">51235/TCP</strong> reachable from the internet</li>
            <li>≥1,100 FALCON on the validator address (2,000 FALCON faucet drip recommended)</li>
          </ul>
        </section>

        {/* Dashboard */}
        <section className="card p-5 space-y-2">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Validator dashboard</h2>
          <p className="text-xs text-slate-400">
            After bootstrap, open <code className="text-emerald-300">http://&lt;your-server-ip&gt;:8080</code> in your browser.
            The bootstrap script prints your droplet IP at the end. Port <strong className="text-amber-300">8080</strong> must be open in your cloud firewall.
          </p>
          <p className="text-xs text-slate-500">
            Shows server state, ledger height, peers, bond status, and composite score (auto-refreshes every 10s).
          </p>
        </section>

        {/* Commands */}
        <section className="card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Useful commands</h2>
          <p className="text-xs text-slate-500">Run on your server. Replace <code className="text-slate-400">&lt;validator-r-address&gt;</code> and your public IP.</p>
          <div className="space-y-2">
            {SERVER_COMMANDS.map(row => (
              <div key={row.label} className="flex items-start gap-2 group">
                <span className="text-slate-600 text-[10px] w-24 flex-shrink-0 pt-1">{row.label}</span>
                <div className="flex-1 min-w-0">
                  <code className="block text-[10px] font-mono text-cyan-700 break-all bg-slate-950/50 rounded px-2 py-1">{row.cmd}</code>
                  {row.note && <p className="text-[10px] text-slate-500 mt-0.5">{row.note}</p>}
                </div>
                <CopyBtn text={row.cmd} />
              </div>
            ))}
          </div>
        </section>

        {/* Links */}
        <section className="card p-5 space-y-2 text-sm">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Links</h2>
          <ul className="space-y-1 text-slate-400">
            <li><a href={PORTAL_URL} className="text-brand-400 hover:underline">Faucet + Wallet portal</a></li>
            <li><a href={`${PORTAL_URL}/scan`} className="text-brand-400 hover:underline">Block explorer</a></li>
            <li><a href="https://github.com/beartec-jpg/qXRP/blob/develop/docs/validator-onboarding.md" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">validator-onboarding.md (GitHub)</a></li>
            <li><a href="https://github.com/beartec-jpg/FalconLedger/blob/develop/bin/install/install-qxrp-validator.sh" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">install-qxrp-validator.sh source</a></li>
            <li>Docker image: <code className="text-emerald-400">qxrp/xrpld:btc-spv-v6</code> (Bitcoin SPV bridge fleet)</li>
          </ul>
        </section>

        <p className="text-center text-xs text-slate-600 pb-8">
          <Link href="/community" className="hover:text-slate-400">← Back to Community</Link>
        </p>
      </main>
    </ProductShell>
  )
}