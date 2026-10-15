import ContentPage, { A, Section } from '@/components/content/ContentPage'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/testnet-faucet',
  'FPL testnet faucet',
  'Get free Falcon PL testnet FPL: create a post-quantum wallet, claim from the faucet, then try swaps, pools, lending and the arcade.',
)

export default function TestnetFaucetPage() {
  return (
    <ContentPage current="faucet" title="FPL testnet faucet" back={{ href: '/faucet', label: 'Faucet' }}>
      <p>
        The Falcon PL faucet gives free test FPL on testnet 2300 so you can try a post-quantum (Falcon-512)
        wallet. Testnet FPL has no cash value.
      </p>
      <Section title="How to get test FPL">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Create a wallet at <A href="/wallet">Wallet</A>.</li>
          <li>Open the <A href="/faucet">faucet</A> and request a drip.</li>
          <li>Come back on other days; faucet days may count toward the activity score.</li>
        </ol>
      </Section>
      <Section title="What to do next">
        <ul className="list-disc pl-5 space-y-1">
          <li><A href="/swap">Swap</A>, <A href="/pool">provide liquidity</A> or <A href="/lend">lend</A></li>
          <li>Play the <A href="/arcade">arcade</A></li>
          <li>Read the <A href="/community/faq">FAQ</A></li>
        </ul>
      </Section>
    </ContentPage>
  )
}
