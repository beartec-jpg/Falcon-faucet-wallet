'use client'

import { useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'

const NETWORK_NAME = process.env.NEXT_PUBLIC_NETWORK_NAME ?? 'Falcon Ledger Testnet'
const DRIP_AMOUNT  = parseInt(process.env.NEXT_PUBLIC_DRIP_AMOUNT_QXRP ?? '2000', 10)
const PUBLIC_RPC   = process.env.NEXT_PUBLIC_RPC_URL ?? 'http://46.224.0.140:6005'
const PORTAL_URL   = 'https://falcon-ledger.com'

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

const STEPS = [
  { n: 1, title: 'Create a Falcon wallet', body: 'Open the Wallet tab and create a passkey-secured wallet. Back up your falcon_secret.' },
  { n: 2, title: `Claim ${DRIP_AMOUNT.toLocaleString()} FALCON from the faucet`, body: 'Use the Faucet tab (or Wallet → Top up). One drip per day per IP/account gives enough for bonding.' },
  { n: 3, title: 'Copy the one-liner', body: 'In Wallet → Run Validator, copy the install command. Your wallet address is auto-filled as --payout.' },
  { n: 4, title: 'Run on Ubuntu VPS', body: 'Paste into an Ubuntu 22.04/24.04 server with port 51235/TCP open. Docker installs automatically.' },
  { n: 5, title: 'Fund the validator address', body: 'The installer prints a NEW validator r-address. Send ≥1,100 FALCON there (from your wallet or another drip tomorrow).' },
  { n: 6, title: 'Auto-bond + rewards', body: 'Installer polls until funded, submits ValidatorRegister + Bond(1000), and sets up hourly ClaimReward cron.' },
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

export default function ValidatorGuidePage() {
  const oneLiner = `curl -fsSL https://raw.githubusercontent.com/beartec-jpg/qXRP/develop/bin/install/bootstrap-qxrp-validator.sh | bash -s -- \\
  --payout rYourWalletAddress \\
  --node-name my-falcon-node`

  return (
    <div className="min-h-screen flex flex-col">
      <Header current="wallet" subtitle="Validator guide" />

      <main className="flex-1 px-4 py-8 max-w-3xl mx-auto w-full space-y-6">
        <div>
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
            {STEPS.map(s => (
              <li key={s.n} className="flex gap-3 text-sm">
                <span className="text-cyan-600 font-mono text-xs w-6 flex-shrink-0 pt-0.5">{String(s.n).padStart(2, '0')}</span>
                <div>
                  <div className="font-medium text-slate-200">{s.title}</div>
                  <div className="text-slate-500 text-xs mt-0.5">{s.body}</div>
                </div>
              </li>
            ))}
          </ol>
          <Link href="/wallet" className="inline-block text-sm text-brand-400 hover:text-brand-300">
            Open Wallet → Run Validator panel →
          </Link>
        </section>

        {/* One-liner template */}
        <section className="card p-5 space-y-2">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">One-liner template</h2>
          <p className="text-xs text-slate-500">Replace <code className="text-slate-400">rYourWalletAddress</code> with your Falcon wallet address (auto-filled in the Wallet panel).</p>
          <div className="relative">
            <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] text-emerald-300 font-mono whitespace-pre-wrap break-all pr-12">{oneLiner}</pre>
            <div className="absolute top-2 right-2"><CopyBtn text={oneLiner} /></div>
          </div>
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
            <li><a href="https://github.com/beartec-jpg/qXRP/blob/develop/bin/install/install-qxrp-validator.sh" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">install-qxrp-validator.sh source</a></li>
          </ul>
        </section>

        <p className="text-center text-xs text-slate-600 pb-8">
          <Link href="/wallet" className="hover:text-slate-400">← Back to Wallet</Link>
        </p>
      </main>
    </div>
  )
}