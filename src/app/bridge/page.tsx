import ContentPage, { A, Section } from '@/components/content/ContentPage'
import { pageMeta } from '@/lib/seo'
import BridgePanel from './BridgePanel'

export const metadata = pageMeta(
  '/bridge',
  'TESTNET4 BTC bridge (test coins only)',
  'Falcon PL BitVM2 bridge test on Bitcoin testnet4: deposit test tBTC, receive bridged BTC on Falcon PL, withdraw back to testnet4. Test coins only.',
)

const STEPS: Array<[string, string]> = [
  ['1. Peg-in graph presigning', 'Before a deposit is broadcast, the three test operators (falcon1, falcon2, beartec-brain) and your browser wallet presign the full BitVM2 transaction graph for it (PegOut, KickOff, Take 1/Take 2, Assert, Disprove). Your wallet signs the peg-in with its own Bitcoin key in the browser; the operators use one-time keys that are deleted after signing (with signed deletion attestations). Every operator binds or co-signs the graph on the Falcon ledger, and the peg-in is not broadcast until all have.'],
  ['2. Deposit and mint', 'You send testnet4 tBTC to the deposit (peg-in) address. Once the peg-in confirm transaction has enough confirmations, its SPV proof is submitted to the Falcon ledger and bridged BTC is minted to your Falcon PL account.'],
  ['3. Withdraw: burn + operator fronts payout', 'You burn bridged BTC on Falcon PL naming a testnet4 address. An operator pays you from its own testnet4 funds (PegOut), then claims reimbursement from the deposit through its presigned graph (KickOff -> Take 1).'],
  ['4. Challenge window', 'Anyone watching can challenge a claim during the window. A challenged operator must post its Assert transactions with a proof that it paid correctly.'],
  ['5. Disprove slashing', 'If the Assert proof is invalid, any watcher can publish a Disprove transaction on Bitcoin. That blocks the operator from taking the deposit and is evidence for a 100% slash of its bond on the Falcon ledger.'],
  ['6. Refund timelock', 'If a withdrawal is never paid within the refund window, the burned bridged BTC is credited back to the withdrawer on Falcon PL.'],
]

export default function BridgePage() {
  return (
    <ContentPage current="vault" title="BTC bridge — TESTNET4" back={{ href: '/', label: 'Home' }}>
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
        <strong>TESTNET4 ONLY — test coins only.</strong> This is a test of a BitVM2 bridge design on Bitcoin testnet4. Testnet
        coins have no value. Do not send real (mainnet) BTC. The design is intended to be non-custodial, but it is unreviewed
        test software and is not presented as production non-custody until an outside review is complete.
      </div>

      <BridgePanel />

      <Section title="How it works">
        <ol className="space-y-3">
          {STEPS.map(([t, d]) => (
            <li key={t}>
              <div className="font-semibold">{t}</div>
              <div className="text-sm text-slate-400">{d}</div>
            </li>
          ))}
        </ol>
        <p className="text-sm text-slate-400">
          Flow: deposit → graphs presigned &amp; bound → peg-in confirmed → mint → burn → operator PegOut → KickOff → (challenge →
          Assert → Disprove ⇒ slash) or Take 1 after the window → (no payout ⇒ refund after timelock).
        </p>
      </Section>

      <Section title="Path to mainnet">
        <p className="text-sm text-slate-400">Testnet shortcuts that must be replaced before any mainnet value:</p>
        <ul className="list-disc pl-5 text-sm text-slate-400 space-y-1">
          <li>Multi-party Groth16 ceremony with independent contributors and a published, re-derivable transcript (today: single-party testnet VK).</li>
          <li>Full mainnet timelocks (testnet4 uses mainnet/28, e.g. 2 weeks → 72 blocks).</li>
          <li>Independent operators and signers on separate infrastructure with proper key custody.</li>
          <li>External security review of the BitVM patch, operator kit, watcher and ceremony.</li>
          <li>A tested miner route for the large non-standard Disprove transaction (~956k WU exercised, up to ~3.99M WU worst case; MARA Slipstream may cap at ~400k WU — open issue).</li>
          <li>Mandatory graph-binding checks, real fee policy, own Bitcoin/esplora infrastructure, and a small-value mainnet acceptance test of all paths.</li>
        </ul>
        <p className="text-sm text-slate-400">
          Tested so far: deposit, refund and Take 1 on testnet4; on-chain Disprove on the Falcon PL test signet (
          <A href="https://5-78-142-246.sslip.io/tx/cd693dc09dc3ed6b24ceeeb110f41a591cb414f1b2892709c209474d41e8fd53">Disprove tx</A>,{' '}
          <A href="https://github.com/beartec-jpg/Falcon-PL/pull/127">bridge PR</A>). Full list:{' '}
          <A href="https://github.com/beartec-jpg/Falcon-PL/blob/feat/bridge-integration/docs/bridge/MAINNET_MIGRATION.md">MAINNET_MIGRATION.md</A>.
        </p>
      </Section>
    </ContentPage>
  )
}
