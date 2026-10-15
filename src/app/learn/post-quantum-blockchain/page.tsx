import ContentPage, { A, Section } from '@/components/content/ContentPage'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/learn/post-quantum-blockchain',
  'What is a post-quantum blockchain?',
  'How Falcon PL uses Falcon-512 post-quantum signatures from genesis, and why quantum-safe signing matters for a blockchain ledger.',
)

export default function PostQuantumBlockchainPage() {
  return (
    <ContentPage current="whitepaper" title="What is a post-quantum blockchain?" back={{ href: '/whitepaper', label: 'Whitepaper' }}>
      <p>
        A post-quantum blockchain signs transactions with cryptography designed to stay secure against
        large-scale quantum computers. Falcon PL is a quantum-safe participation ledger: every account and
        validator uses Falcon-512 signatures from the very first block.
      </p>
      <Section title="Why signatures matter">
        <p>
          On a ledger, a signature is what proves you own an account. If the signature scheme can be broken,
          funds can be moved by someone who never held the key. Falcon PL puts post-quantum cryptography at
          the foundation rather than bolting it on later.
        </p>
      </Section>
      <Section title="Falcon-512 from genesis">
        <p>
          Falcon PL runs Falcon Consensus with Falcon-512 signatures from genesis, so there are no legacy
          accounts to migrate. The site wallet signs in your browser and is passkey secured.
        </p>
      </Section>
      <Section title="Try it on testnet 2300">
        <ul className="list-disc pl-5 space-y-1">
          <li>Create a wallet: <A href="/wallet">Wallet</A></li>
          <li>Get test FPL: <A href="/testnet-faucet">Testnet faucet</A></li>
          <li>Watch the chain: <A href="/scan">Explorer</A></li>
          <li>Run a node: <A href="/validator/run-a-node">Run a Falcon PL node</A></li>
        </ul>
        <p className="text-slate-500">Testnet FPL has no cash value.</p>
      </Section>
      <p className="text-slate-400">
        Full design: <A href="/whitepaper">Falcon PL whitepaper</A>.
      </p>
    </ContentPage>
  )
}
