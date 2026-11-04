// Copyright (c) 2026 BEARTEC LTD. All rights reserved. See LICENSE.
import ContentPage, { Section, A } from '@/components/content/ContentPage'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/privacy',
  'Privacy Policy',
  'How BEARTEC LTD uses personal data for falcon-fpl.com, the Falcon PL testnet, the Falcon arcade and Falcon Cloud.',
)

/** Placeholder that must be completed before publication. */
const TBC = ({ children }: { children: React.ReactNode }) => (
  <span className="bg-amber-500/20 text-amber-300 px-1 rounded">[TBC: {children}]</span>
)

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} className="text-left p-2 border-b border-slate-700 text-white">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="p-2 border-b border-slate-800 align-top">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PrivacyPage() {
  return (
    <ContentPage current="community" title="Privacy Policy">
      <p className="text-slate-400">Last updated: 4 November 2026</p>
      <p className="text-slate-400">
        For falcon-fpl.com, its subdomains, the Falcon arcade and Falcon Cloud. See also our <A href="/terms-of-use">Terms of Use</A> and the <A href="/terms">Testnet Allocation Programme terms</A>.
      </p>

      <Section title="1. Who we are">
        <p>
          Falcon PL, the testnet, the wallet, faucet, explorer, arcade and Falcon Cloud are run by BEARTEC LTD, a company registered in England and Wales (company number 17166952), registered office 33 Salt Works Lane, Weston, Stafford, England, ST18 0LW (&quot;BEARTEC&quot;, &quot;we&quot;, &quot;us&quot;). We are the controller of the personal data described here. Contact: <a href="mailto:falconledger@beartec.uk" className="text-amber-300 hover:underline">falconledger@beartec.uk</a>. ICO registration number: <TBC>ICO registration number</TBC>.
        </p>
      </Section>

      <Section title="2. Public blockchain data">
        <p className="text-amber-200">
          Falcon PL is a public ledger. Your account name, wallet addresses and transactions (including faucet claims, swaps, bridge transfers and validator activity) are recorded on-chain and are visible to anyone, including in our explorer. On-chain records cannot be changed or deleted, by us or by anyone else, so the rights to erasure and correction cannot be applied to them. Do not put personal information (such as your real name or email) in an account name or a transaction memo.
        </p>
      </Section>

      <Section title="3. Data we collect off-chain">
        <Table
          head={['Feature', 'Data', 'Lawful basis']}
          rows={[
            ['Wallet', "Your keys are generated and encrypted on your device with your passkey. We do not receive your Falcon secret, passkey private key or EVM private key. The wallet stores data in your browser's local storage.", 'n/a (not collected)'],
            ['Faucet', 'Wallet address, network, amount, transaction hash, date, and a one-way salted hash of your IP address (used to apply daily limits)', 'Legitimate interests (preventing abuse)'],
            ['Feedback and bug reports', 'Account name, category, area, description, optional contact handle, screenshots you upload, salted IP hash, review status', 'Legitimate interests (testing and improving the network; recognising valid reports)'],
            ['First 35 seats', 'Account name, Telegram, Discord and X handles, note, salted IP hash, application status and seat', 'Legitimate interests (running the programme you applied to)'],
            ['Arcade (falcon-fpl.com/arcade)', 'Wallet address, Falcon PL account, game, scores, runs and claims', 'Legitimate interests (leaderboards and test rewards)'],
            ['Validators and operators', 'Seat ID, contact email or handle you give when installing, node addresses and performance data', 'Contract or legitimate interests'],
            ['Allocation programme', 'Recorded activity and scores linked to your account, the snapshot, and any eligibility checks', 'Legitimate interests; legal obligation (sanctions)'],
            ['Falcon Cloud', 'Name, email, organisation, API key, plan, usage counts (requests, units, transaction submits) and payment records. Card payments are taken by Stripe; we do not see or store your full card number', 'Contract; legal obligation (tax records)'],
            ['All sites', 'IP address and request data processed briefly for rate limiting and security, and in hosting logs', 'Legitimate interests (security)'],
          ]}
        />
        <p>A salted IP hash is pseudonymised data. It is still personal data, and we protect it in the same way. We do not use advertising or analytics cookies.</p>
      </Section>

      <Section title="4. Who we share data with">
        <Table
          head={['Provider', 'Purpose', 'Location']}
          rows={[
            ['Vercel', 'Hosting of falcon-fpl.com and the arcade', 'USA and global edge network'],
            ['Neon', 'Database for faucet, feedback, First 35, arcade and explorer data', <TBC key="neon">region</TBC>],
            ['Upstash', 'Rate limiting (short-lived IP counters)', <TBC key="upstash">region</TBC>],
            ['Stripe', 'Card payments for paid Falcon Cloud plans (when online payment is switched on)', 'UK, EU and USA'],
            ['Server providers for validator and archive nodes', 'Running the testnet (node logs may contain peer IP addresses)', <TBC key="nodes">provider names and regions</TBC>],
            ['Discord', 'Internal health alerts only (no user data is intended to be sent)', 'USA'],
          ]}
        />
        <p>Public leaderboards (including the arcade leaderboard) show account names, addresses and scores. Feedback descriptions and contact handles are not shown publicly. We do not sell personal data.</p>
      </Section>

      <Section title="5. International transfers">
        <p>Some providers process data outside the UK, mainly in the USA. Where they do, we rely on UK adequacy regulations (including the UK extension to the EU-US Data Privacy Framework where the provider is certified) or on the ICO&apos;s International Data Transfer Agreement or UK Addendum to the EU standard contractual clauses. You can ask us for details.</p>
      </Section>

      <Section title="6. Retention">
        <Table
          head={['Data', 'Retention']}
          rows={[
            ['Faucet claims, arcade scores, feedback, First 35 applications', 'Until the mainnet snapshot and allocation are complete, plus 12 months to handle disputes; then deleted or anonymised'],
            ['Falcon Cloud customer and billing records', 'During the plan, then 6 years after the end of the financial year (tax law)'],
            ['Hosting and rate-limit logs', <TBC key="logs">retention period</TBC>],
            ['On-chain data', 'Permanent (see section 2)'],
          ]}
        />
      </Section>

      <Section title="7. Your rights">
        <p>You can ask to access, correct or erase off-chain data, restrict or object to its use, or receive it in a portable format, by emailing <a href="mailto:falconledger@beartec.uk" className="text-amber-300 hover:underline">falconledger@beartec.uk</a>. We will reply within one month. On-chain data cannot be erased. You can complain to the ICO (<a href="https://ico.org.uk" className="text-amber-300 hover:underline" target="_blank" rel="noopener noreferrer">ico.org.uk</a>, 0303 123 1113).</p>
      </Section>

      <Section title="8. Children">
        <p>Falcon PL, the arcade and its programmes are for people aged 18 and over.</p>
      </Section>

      <Section title="9. Changes">
        <p>We will post changes here with a new date.</p>
      </Section>
    </ContentPage>
  )
}
