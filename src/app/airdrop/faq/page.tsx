import { headers } from 'next/headers'
import ContentPage, { A, Section } from '@/components/content/ContentPage'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/airdrop/faq',
  'Airdrop FAQ',
  'Falcon PL airdrop FAQ: the 1B pre-mainnet airdrop pool, how testnet activity may count, the 9 activity categories, First 35 and arcade prizes.',
)

const FAQ: { q: string; a: string }[] = [
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
    <ContentPage current="airdrop" title="Airdrop FAQ" back={{ href: '/airdrop', label: 'Community allocation' }}>
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <p className="text-slate-400">No guarantees. Everything here is subject to change.</p>
      {FAQ.map(({ q, a }) => (
        <Section key={q} title={q}>
          <p>{a}</p>
        </Section>
      ))}
      <p className="text-slate-400">
        Scoring details: <A href="/scan/methodology">how activity is counted</A>. Seats:{' '}
        <A href="/first-35">First 35</A>.
      </p>
    </ContentPage>
  )
}
