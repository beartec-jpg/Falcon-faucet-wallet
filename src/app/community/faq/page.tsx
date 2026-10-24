import { headers } from 'next/headers'
import ContentPage, { A, Section } from '@/components/content/ContentPage'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/community/faq',
  'FAQ',
  'Falcon PL FAQ: what Falcon PL is, testnet FPL, running a node, and the airdrop (1B pre-mainnet pool, activity categories, First 35, arcade prizes).',
)

const GENERAL: { q: string; a: string }[] = [
  {
    q: 'What is Falcon PL?',
    a: 'Falcon PL is a quantum-safe participation ledger. It uses Falcon Consensus and Falcon-512 post-quantum signatures from genesis. Testnet 2300 is live with a wallet, faucet and explorer; AMM, lending and the dest-lock bridge are experimental.',
  },
  {
    q: 'How do I get testnet FPL?',
    a: 'Create a wallet, then claim test FPL from the faucet. Testnet FPL has no cash value.',
  },
  {
    q: 'Can I run a node or validator?',
    a: 'Yes, on Linux x86-64 with glibc 2.34 or newer, using the one-line installer. Validators bond 50,000 FPL and are approved by Scott.',
  },
]

const AIRDROP: { q: string; a: string }[] = [
  {
    q: 'Is there a Falcon PL airdrop?',
    a: 'A 1B FPL pre-mainnet airdrop pool is planned, from a snapshot of testnet activity. It is a proposed model: nothing is guaranteed and it may change until the mainnet parameter sheet is published.',
  },
  {
    q: 'When is the airdrop?',
    a: 'Dates are to be confirmed.',
  },
  {
    q: 'How does testnet activity count?',
    a: 'Testnet activity may count toward the pre-mainnet airdrop. The activity leaderboard scores 9 categories: bridging 20, swaps 15, liquidity 15, consistency 15, lending 10, payments 10, faucet 5, arcade 5 and watchers 5. Vault use is not counted.',
  },
  {
    q: 'Does testnet FPL have value?',
    a: 'No. Testnet FPL has no cash value and cannot be sold.',
  },
  {
    q: 'What is the First 35?',
    a: 'First 35 is a set of 35 first-adopter prize seats, 12M FPL in total, paid at mainnet launch.',
  },
  {
    q: 'Are there arcade prizes?',
    a: 'Yes. The arcade top 5 share 1.9M FPL in prizes.',
  },
  {
    q: 'How do I start?',
    a: 'Create a wallet, claim test FPL from the faucet, then use swaps, pools, lending, payments and the arcade on testnet 2300.',
  },
]

const FAQ = [...GENERAL, ...AIRDROP]

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
}

export default async function AirdropFaqPage() {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <ContentPage current="community" title="Falcon PL FAQ" back={{ href: '/community', label: 'Community' }}>
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      {GENERAL.map(({ q, a }) => (
        <Section key={q} title={q}>
          <p>{a}</p>
        </Section>
      ))}
      <h2 id="airdrop" className="text-lg font-semibold pt-4" style={{ color: '#E0DBCA' }}>
        Airdrop
      </h2>
      <p className="text-slate-400">No guarantees. Everything here is subject to change.</p>
      {AIRDROP.map(({ q, a }) => (
        <Section key={q} title={q}>
          <p>{a}</p>
        </Section>
      ))}
      <p className="text-slate-400">
        More: <A href="/airdrop">community allocation</A>. Scoring details: <A href="/scan/methodology">how activity is counted</A>. Seats:{' '}
        <A href="/airdrop?tab=first35">First 35</A>. Nodes: <A href="/community/validators/run-a-node">run a node</A>.
      </p>
    </ContentPage>
  )
}
