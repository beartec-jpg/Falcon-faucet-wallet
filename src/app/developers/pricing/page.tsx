// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import ContentPage, { Section } from '@/components/content/ContentPage'
import { DevNav, TestnetNotice } from '@/components/developers/DevBits'
import { TIERS, formatGbp } from '@/lib/developers/content'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta('/developers/pricing', 'RPC pricing', 'Falcon Cloud RPC plans: Free, Builder and Scale. Testnet only.')

const n = (x: number) => x.toLocaleString('en-GB')

export default function PricingPage() {
  return (
    <ContentPage current="community" title="RPC gateway pricing" back={{ href: '/developers', label: 'Developers' }}>
      <DevNav active="/developers/pricing" />
      <TestnetNotice />
      <div className="grid gap-3 sm:grid-cols-3" data-testid="pricing-table">
        {TIERS.map((t) => (
          <Section key={t.id} title={t.name}>
            <p className="text-2xl font-semibold text-white">
              {formatGbp(t.priceGbpMonthly)}
              <span className="text-xs font-normal text-slate-400">{t.priceGbpMonthly ? ' / month' : ''}</span>
            </p>
            <p className="text-xs text-slate-400">{t.blurb}</p>
            <ul className="text-xs space-y-1">
              <li>{t.rps} requests/s (burst {t.burst})*</li>
              <li>{n(t.monthlyUnits)} units / month*</li>
              <li>{t.txPerMin} tx submits / minute*</li>
            </ul>
          </Section>
        ))}
      </div>
      <p className="text-xs text-slate-400" data-testid="provisional-note">
        * Provisional limits, subject to change before launch. One read = 1 unit, one tx submit = 5 units. Quotas reset on the 1st of each month (00:00 UTC). Prices in GBP.
      </p>
      <p className="text-xs text-slate-400">Plans pay for access to BEARTEC-run RPC infrastructure. They do not buy, include or earn FPL, and FPL testnet tokens have no monetary value. Paid plans are not open yet.</p>
    </ContentPage>
  )
}
