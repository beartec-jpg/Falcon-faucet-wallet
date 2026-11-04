// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import Link from 'next/link'
import ContentPage, { Section } from '@/components/content/ContentPage'
import { DevNav, TestnetNotice } from '@/components/developers/DevBits'
import { DEV_PAGES } from '@/lib/developers/content'
import { pageMeta } from '@/lib/seo'

export const metadata = pageMeta('/developers', 'Developers', 'Build on the Falcon PL testnet: RPC gateway, Explorer API, pricing and SDK.')

export default function DevelopersPage() {
  return (
    <ContentPage current="community" title="Developers">
      <DevNav />
      <TestnetNotice />
      <p>Tools for building on the Falcon PL post-quantum testnet (network 2300).</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {DEV_PAGES.map((p) => (
          <Link key={p.href} href={p.href} className="block">
            <Section title={p.title}>
              <p className="text-xs text-slate-400">{p.desc}</p>
            </Section>
          </Link>
        ))}
      </div>
    </ContentPage>
  )
}
