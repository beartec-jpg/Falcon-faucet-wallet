// Copyright (c) 2026 BEARTEC LTD. All rights reserved. See LICENSE.
import ContentPage, { Section, A } from '@/components/content/ContentPage'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta(
  '/terms-of-use',
  'Terms of Use',
  'Terms of use for falcon-fpl.com, the Falcon PL testnet, wallet, faucet, arcade and Falcon Cloud.',
)

const L = ({ items }: { items: string[] }) => (
  <ul className="list-disc pl-5 space-y-1">
    {items.map((i) => (
      <li key={i}>{i}</li>
    ))}
  </ul>
)

export default function TermsOfUsePage() {
  return (
    <ContentPage current="community" title="Terms of Use">
      <p className="text-slate-400">Last updated: 4 November 2026</p>

      <Section title="1. About these terms">
        <p>These terms are between you and BEARTEC LTD, a company registered in England and Wales (company number 17166952), registered office 33 Salt Works Lane, Weston, Stafford, England, ST18 0LW (&quot;BEARTEC&quot;, &quot;we&quot;, &quot;us&quot;). They apply when you use falcon-fpl.com, the Falcon PL testnet, the wallet, faucet, explorer, bridges, swap, pool, lending and order-book test features, the Falcon arcade and Falcon Cloud. The Testnet Allocation Programme has its own terms at <A href="/terms">falcon-fpl.com/terms</A>. Our <A href="/privacy">Privacy Policy</A> explains how we use personal data. Contact: <a href="mailto:falconledger@beartec.uk" className="text-amber-300 hover:underline">falconledger@beartec.uk</a>.</p>
      </Section>

      <Section title="2. Testnet only. Tokens have no value">
        <p className="text-amber-200">Falcon PL is a test network. Testnet FPL and every other test token (including bridged test ETH, USDC and BTC) have no cash value, cannot be sold or swapped for money, and will not turn into mainnet FPL. Nothing on this site is an offer of tokens, an investment or financial advice, and FPL is not an investment. Test rewards, pool figures and leaderboards relate to testing only. We have not set a mainnet date and do not promise that a mainnet will launch.</p>
      </Section>

      <Section title="3. Eligibility">
        <p>You must be 18 or over. You must not live in, or be a resident of, a country under UK, UN, EU or US sanctions, or be on a sanctions list.</p>
      </Section>

      <Section title="4. Your wallet and keys">
        <L items={[
          'The Falcon wallet is self-custody software. Your keys are created and encrypted on your device. We cannot see, recover or reset them.',
          'You are responsible for keeping your Falcon secret, passkey and any backups safe. If you lose them, you lose access, and we cannot help.',
          'Transactions on a blockchain are final once confirmed.',
        ]} />
      </Section>

      <Section title="5. Faucet, bridges and test features">
        <L items={[
          'The faucet gives out test tokens for testing only, within daily limits. We may change the limits or stop the faucet at any time.',
          'Bridges, swaps, pools, lending and the order book are experimental test software. They may fail, be paused, be reset or lose test balances. The BTC testnet3 rail is retiring, and deposits and withdrawals there are paused.',
          'We run the validators and bridge operators on the testnet. We may restart, upgrade or reset the network.',
        ]} />
      </Section>

      <Section title="6. Arcade and community programmes">
        <p>Arcade scores and community programmes (including First 35 and validator seats) are about testing and contribution. Any mainnet allocation is governed only by the <A href="/terms">Testnet Allocation Programme terms</A>, is at our discretion, and is not promised.</p>
      </Section>

      <Section title="7. Fair use">
        <p>You must not break the law; use several accounts, bots or scripts to fake activity; attack, overload or disrupt the network or site; exploit a bug instead of reporting it; or use the service for fraud, money laundering or sanctions evasion. Please report bugs through the <A href="/feedback">feedback page</A>.</p>
      </Section>

      <Section title="8. Software and content">
        <p>The Falcon PL software, site and content belong to BEARTEC (see the LICENSE files in our repositories) or its licensors. Making the code publicly visible does not grant a licence. We give you a personal right to use the site and testnet for testing.</p>
      </Section>

      <Section title="9. No warranty and our responsibility">
        <p>The testnet and all test features are provided &quot;as is&quot;, for testing. Because test tokens have no value, we do not expect you to suffer financial loss from using them. We are not responsible for losses from lost keys, network resets or the failure of test features, except where the law does not allow this to be excluded. Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot be limited by law.</p>
      </Section>

      <Section title="10. Changes, suspension and law">
        <p>We may change these terms; changes will be posted with a new date. We may suspend accounts that break these terms. These terms are governed by the law of England and Wales, and the courts of England and Wales deal with disputes (consumers in Scotland or Northern Ireland may also use their local courts).</p>
      </Section>

      <Section title="Schedule: Falcon Cloud plan terms">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>{['Plan', 'Price', 'Requests a second (burst)', 'Units a month', 'Transaction submits a minute'].map((h) => <th key={h} className="text-left p-2 border-b border-slate-700 text-white">{h}</th>)}</tr>
            </thead>
            <tbody>
              {[['Free', '£0', '5 (10)', '300,000', '10'], ['Builder', '£29 a month', '25 (50)', '5,000,000', '120'], ['Scale', '£199 a month', '100 (200)', '50,000,000', '600']].map((r) => (
                <tr key={r[0]}>{r.map((c, j) => <td key={j} className="p-2 border-b border-slate-800">{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <L items={[
          'Every plan, including Free, needs an API key. One read = 1 unit; one transaction submit = 5 units. Quotas reset at 00:00 UTC on the 1st of each month. Prices are in pounds sterling. BEARTEC is not registered for VAT, so no VAT is charged.',
          'Plans pay for access to BEARTEC-run RPC infrastructure on the testnet. They do not buy, include or earn FPL.',
          'Paid plans are paid monthly in advance by card online through Stripe, where online payment is available for the plan. We do not issue invoices or offer credit terms. Until online payment is switched on, paid plans are not available to buy; keys for the Free plan are arranged on request.',
          'You can cancel at the end of any month by emailing us. If you are a consumer, you also have a 14-day right to cancel a new paid plan. If you asked us to start straight away, we will deduct a proportionate amount for the service already provided.',
          'We aim for good availability but give no uptime guarantee on the testnet. We may suspend keys used for abuse or above quota.',
          'For business customers, our total liability in any year is limited to the fees paid in that year.',
        ]} />
      </Section>
    </ContentPage>
  )
}
