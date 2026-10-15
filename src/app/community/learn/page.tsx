import ContentPage, { A, Section } from '@/components/content/ContentPage'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/community/learn',
  'Learn',
  'Learn about Falcon PL: post-quantum blockchains, Falcon-512, running a node and the testnet.',
)

const ARTICLES = [
  { href: '/community/learn/post-quantum-blockchain', title: 'What is a post-quantum blockchain?', text: 'Why Falcon PL signs with Falcon-512 from genesis.' },
  { href: '/community/validators/run-a-node', title: 'Run a Falcon PL node', text: 'One-line install, validator mode, bond and approval.' },
  { href: '/testnet-faucet', title: 'FPL testnet faucet', text: 'Get test FPL and try the wallet.' },
  { href: '/community/faq', title: 'FAQ', text: 'Common questions, including the airdrop.' },
  { href: '/whitepaper', title: 'Whitepaper', text: 'The full Falcon PL design.' },
]

export default function LearnIndexPage() {
  return (
    <ContentPage current="community" title="Learn" back={{ href: '/community', label: 'Community' }}>
      {ARTICLES.map((a) => (
        <Section key={a.href} title={a.title}>
          <p>
            {a.text} <A href={a.href}>Read →</A>
          </p>
        </Section>
      ))}
    </ContentPage>
  )
}
