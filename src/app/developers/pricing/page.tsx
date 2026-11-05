// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import ContentPage, { Section } from '@/components/content/ContentPage'
import { DevNav, TestnetNotice } from '@/components/developers/DevBits'
import { TIERS, formatGbp } from '@/lib/developers/content'
import { pageMeta } from '@/lib/seo'
import CheckoutButton from '@/components/developers/CheckoutButton'
import KeyReveal from '@/components/developers/KeyReveal'
import { FALCON_TERMS_PATH, normalizePaidTier } from '@/lib/developers/stripe-tiers'

export const metadata = pageMeta('/developers/pricing', 'RPC pricing', 'Falcon Cloud RPC plans: Free, Builder and Scale. Testnet only.')

const n = (x: number) => x.toLocaleString('en-GB')

export default function PricingPage() {
  return (
    <ContentPage current="community" title="RPC gateway pricing" back={{ href: '/developers', label: 'Developers' }}>
      <DevNav active="/developers/pricing" />
      <TestnetNotice />
      <KeyReveal />
      <div className="grid gap-3 sm:grid-cols-3" data-testid="pricing-table">
        {TIERS.map((t) => (
          <Section key={t.id} title={t.name}>
            <p className="text-2xl font-semibold text-white">
              {formatGbp(t.priceGbpMonthly)}
              <span className="text-xs font-normal text-slate-400">{t.priceGbpMonthly ? ' / month' : ''}</span>
            </p>
            <p className="text-xs text-slate-400">{t.blurb}</p>
            <ul className="text-xs space-y-1">
              <li>{t.rps} requests/s (burst {t.burst})</li>
              <li>{n(t.monthlyUnits)} units / month</li>
              <li>{t.txPerMin} tx submits / minute</li>
            </ul>
            {normalizePaidTier(t.id) && <CheckoutButton tier={t.id} label={`Subscribe to ${t.name}`} />}
          </Section>
        ))}
      </div>
      <p className="text-xs text-slate-400" data-testid="limits-note">
        Confirmed limits. Every plan, including Free, needs an API key. One read = 1 unit, one tx submit = 5 units. Quotas reset on the 1st of each month (00:00 UTC). Prices in GBP.
      </p>
      <p className="text-xs text-slate-400">Plans pay for access to BEARTEC-run RPC infrastructure. They do not buy, include or earn FPL, and FPL testnet tokens have no monetary value. Paid plans are monthly card subscriptions through Stripe Checkout, billed in GBP with no VAT added (BEARTEC is not VAT registered). We do not issue invoices. After you subscribe, your API key is shown once on this page when you return from checkout (copy it then; we only keep a hash); Free keys and plan changes are arranged on request through BEARTEC. You can cancel at the end of any month by contacting BEARTEC; consumers also have a 14-day right to cancel a new paid plan.</p>
      <p className="text-xs text-slate-400" data-testid="checkout-terms">By subscribing you agree to the <a className="underline" href={FALCON_TERMS_PATH}>Falcon PL Terms of Use</a>, including the Falcon Cloud plan schedule.</p>
    </ContentPage>
  )
}
